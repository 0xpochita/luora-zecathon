use proc_macro2::TokenTree;
use serde_json::{json, Value};
use syn::visit::Visit;
use std::collections::HashMap;
use syn::{Arm, Attribute, Fields, ItemEnum, ItemImpl, ItemStruct, LitStr, Meta, Pat};

enum ErrorAttr {
    Message(String),
    Transparent,
}

fn read_error_attr(attrs: &[Attribute]) -> Option<ErrorAttr> {
    for attr in attrs {
        if !attr.path().is_ident("error") {
            continue;
        }
        let Meta::List(list) = &attr.meta else { continue };
        let first = list.tokens.clone().into_iter().next()?;
        return match first {
            TokenTree::Ident(ident) if ident == "transparent" => Some(ErrorAttr::Transparent),
            TokenTree::Literal(literal) => {
                let lit: LitStr = syn::parse_str(&literal.to_string()).ok()?;
                Some(ErrorAttr::Message(lit.value()))
            }
            _ => None,
        };
    }
    None
}

fn derives_error(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path().is_ident("derive")
            && quote::quote!(#attr).to_string().split(|c: char| !c.is_alphanumeric() && c != '_').any(|word| word == "Error")
    })
}

fn source_type(fields: &Fields) -> Option<String> {
    let field = fields.iter().find(|field| {
        field.attrs.iter().any(|attr| attr.path().is_ident("from") || attr.path().is_ident("source"))
            || field.ident.as_ref().is_some_and(|ident| ident == "source")
    })?;
    let ty = &field.ty;
    Some(quote::quote!(#ty).to_string().replace(' ', ""))
}

fn entry(type_name: &str, variant: &str, line: usize, attr: Option<ErrorAttr>, fields: &Fields) -> Value {
    let (message, transparent) = match attr {
        Some(ErrorAttr::Message(message)) => (Some(message), false),
        Some(ErrorAttr::Transparent) => (None, true),
        None => (None, false),
    };
    json!({
        "type": type_name,
        "variant": variant,
        "line": line,
        "message": message,
        "transparent": transparent,
        "source": source_type(fields),
    })
}

struct Collector {
    found: Vec<Value>,
    display_messages: HashMap<(String, String), String>,
}

fn first_string_literal(tokens: proc_macro2::TokenStream) -> Option<String> {
    for token in tokens {
        match token {
            TokenTree::Literal(literal) => {
                if let Ok(lit) = syn::parse_str::<LitStr>(&literal.to_string()) {
                    return Some(lit.value());
                }
            }
            TokenTree::Group(group) => {
                if let Some(found) = first_string_literal(group.stream()) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

fn arm_variant(pat: &Pat) -> Option<(String, String)> {
    let path = match pat {
        Pat::Path(pat) => &pat.path,
        Pat::TupleStruct(pat) => &pat.path,
        Pat::Struct(pat) => &pat.path,
        _ => return None,
    };
    let segments: Vec<String> = path.segments.iter().map(|segment| segment.ident.to_string()).collect();
    match segments.as_slice() {
        [.., type_name, variant] => Some((type_name.clone(), variant.clone())),
        _ => None,
    }
}

struct DisplayArms<'a> {
    self_type: String,
    messages: &'a mut HashMap<(String, String), String>,
}

impl<'ast> Visit<'ast> for DisplayArms<'_> {
    fn visit_arm(&mut self, arm: &'ast Arm) {
        if let Some((type_name, variant)) = arm_variant(&arm.pat) {
            let type_name = if type_name == "Self" { self.self_type.clone() } else { type_name };
            let body = &arm.body;
            if let Some(message) = first_string_literal(quote::quote!(#body)) {
                self.messages.entry((type_name, variant)).or_insert(message);
            }
        }
        syn::visit::visit_arm(self, arm);
    }
}

impl<'ast> Visit<'ast> for Collector {
    fn visit_item_impl(&mut self, item: &'ast ItemImpl) {
        let is_display = item
            .trait_
            .as_ref()
            .and_then(|(_, path, _)| path.segments.last())
            .is_some_and(|segment| segment.ident == "Display");
        if let (true, syn::Type::Path(self_type)) = (is_display, item.self_ty.as_ref()) {
            if let Some(segment) = self_type.path.segments.last() {
                let mut arms = DisplayArms { self_type: segment.ident.to_string(), messages: &mut self.display_messages };
                arms.visit_item_impl(item);
            }
        }
        syn::visit::visit_item_impl(self, item);
    }

    fn visit_item_enum(&mut self, item: &'ast ItemEnum) {
        let enum_attr = read_error_attr(&item.attrs);
        let has_variant_attrs = item.variants.iter().any(|variant| read_error_attr(&variant.attrs).is_some());
        if derives_error(&item.attrs) || has_variant_attrs || enum_attr.is_some() {
            let enum_message = match &enum_attr {
                Some(ErrorAttr::Message(message)) => Some(message.clone()),
                _ => None,
            };
            for variant in &item.variants {
                let attr = read_error_attr(&variant.attrs)
                    .or_else(|| enum_message.clone().map(ErrorAttr::Message));
                self.found.push(entry(
                    &item.ident.to_string(),
                    &variant.ident.to_string(),
                    variant.ident.span().start().line,
                    attr,
                    &variant.fields,
                ));
            }
        }
        syn::visit::visit_item_enum(self, item);
    }

    fn visit_item_struct(&mut self, item: &'ast ItemStruct) {
        if let Some(attr) = read_error_attr(&item.attrs) {
            let name = item.ident.to_string();
            self.found.push(entry(&name, &name, item.ident.span().start().line, Some(attr), &item.fields));
        }
        syn::visit::visit_item_struct(self, item);
    }
}

fn main() {
    let mut files = Vec::new();
    for path in std::env::args().skip(1) {
        let source = std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{path}: {err}"));
        let parsed = syn::parse_file(&source).unwrap_or_else(|err| panic!("{path}: {err}"));
        let mut collector = Collector { found: Vec::new(), display_messages: HashMap::new() };
        collector.visit_file(&parsed);
        for found in collector.found.iter_mut() {
            if found["message"].is_null() && !found["transparent"].as_bool().unwrap_or(false) {
                let key = (found["type"].as_str().unwrap_or_default().to_string(), found["variant"].as_str().unwrap_or_default().to_string());
                if let Some(message) = collector.display_messages.get(&key) {
                    found["message"] = json!(message);
                    found["messageFrom"] = json!("Display");
                }
            }
        }
        files.push(json!({ "file": path, "errors": collector.found }));
    }
    println!("{}", serde_json::to_string_pretty(&files).unwrap());
}

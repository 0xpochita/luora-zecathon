use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::model::CoreError;

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| error_to_js(&CoreError::new("serialize-failed", e.to_string())))
}

fn error_to_js(error: &CoreError) -> JsValue {
    error
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap_or_else(|_| JsValue::from_str(&error.message))
}

fn finish<T: Serialize>(result: Result<T, CoreError>) -> Result<JsValue, JsValue> {
    match result {
        Ok(value) => to_js(&value),
        Err(error) => Err(error_to_js(&error)),
    }
}

fn input_values(values: JsValue) -> Result<Vec<Option<u64>>, JsValue> {
    if values.is_undefined() || values.is_null() {
        return Ok(vec![]);
    }
    let raw: Vec<Option<f64>> = serde_wasm_bindgen::from_value(values).map_err(|e| {
        error_to_js(&CoreError::new(
            "bad-input-values",
            format!("transparentInputValuesZat must be an array of numbers or null: {e}"),
        ))
    })?;
    raw.into_iter()
        .map(|v| match v {
            None => Ok(None),
            Some(n) if n >= 0.0 && n.fract() == 0.0 && n <= 9_007_199_254_740_991.0 => Ok(Some(n as u64)),
            Some(n) => Err(error_to_js(&CoreError::new(
                "bad-input-values",
                format!("{n} is not a whole number of zatoshi"),
            ))),
        })
        .collect()
}

#[wasm_bindgen]
pub fn decode_tx(hex: &str, network: &str) -> Result<JsValue, JsValue> {
    finish(crate::decode_tx(hex, network))
}

#[wasm_bindgen]
pub fn check_tx(
    hex: &str,
    network: &str,
    height: u32,
    transparent_input_values_zat: JsValue,
) -> Result<JsValue, JsValue> {
    let values = input_values(transparent_input_values_zat)?;
    finish(crate::check_tx(hex, network, height, &values))
}

#[wasm_bindgen]
pub fn fee_zat(hex: &str, transparent_input_values_zat: JsValue) -> Result<JsValue, JsValue> {
    let values = input_values(transparent_input_values_zat)?;
    finish(crate::fee_zat(hex, &values))
}

#[wasm_bindgen]
pub fn inspect_pczt(base64_or_hex: &str, network: &str) -> Result<JsValue, JsValue> {
    finish(crate::inspect_pczt(base64_or_hex, network))
}

#[wasm_bindgen]
pub fn upgrade_at(network: &str, height: u32) -> Result<JsValue, JsValue> {
    finish(crate::upgrade_at(network, height))
}

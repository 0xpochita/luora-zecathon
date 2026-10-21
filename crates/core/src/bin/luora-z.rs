use std::io::Read;
use std::process::ExitCode;

const USAGE: &str = "usage: luora-z <decode|check|fee|pczt|upgrade> [--network main|test|regtest] [--height N] [--inputs v1,v2,...] [HEX|-]";

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn parse_input_values(list: &str) -> Result<Vec<Option<u64>>, String> {
    if list.is_empty() {
        return Ok(vec![]);
    }
    list.split(',')
        .map(|v| match v.trim() {
            "null" | "?" => Ok(None),
            n => n.parse::<u64>().map(Some).map_err(|e| format!("bad input value {n:?}: {e}")),
        })
        .collect()
}

fn run(args: Vec<String>) -> Result<String, String> {
    let mut args = args.into_iter();
    let command = args.next().ok_or(USAGE)?;
    let mut network = "main".to_string();
    let mut height: Option<u32> = None;
    let mut inputs: Vec<Option<u64>> = vec![];
    let mut payload: Option<String> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--network" => network = args.next().ok_or(USAGE)?,
            "--height" => {
                height = Some(args.next().ok_or(USAGE)?.parse().map_err(|e| format!("bad height: {e}"))?)
            }
            "--inputs" => inputs = parse_input_values(&args.next().ok_or(USAGE)?)?,
            "-" => {
                let mut buf = String::new();
                std::io::stdin().read_to_string(&mut buf).map_err(|e| e.to_string())?;
                payload = Some(buf);
            }
            other => payload = Some(other.to_string()),
        }
    }
    let payload = || payload.clone().ok_or_else(|| USAGE.to_string());
    let json = match command.as_str() {
        "decode" => serde_json::to_string_pretty(&luora_z_core::decode_tx(&payload()?, &network).map_err(|e| e.to_string())?),
        "check" => serde_json::to_string_pretty(
            &luora_z_core::check_tx(&payload()?, &network, height.ok_or("check needs --height")?, &inputs)
                .map_err(|e| e.to_string())?,
        ),
        "fee" => serde_json::to_string_pretty(&luora_z_core::fee_zat(&payload()?, &inputs).map_err(|e| e.to_string())?),
        "pczt" => serde_json::to_string_pretty(&luora_z_core::inspect_pczt(&payload()?, &network).map_err(|e| e.to_string())?),
        "upgrade" => serde_json::to_string_pretty(
            &luora_z_core::upgrade_at(&network, height.ok_or("upgrade needs --height")?).map_err(|e| e.to_string())?,
        ),
        _ => return Err(USAGE.to_string()),
    };
    json.map_err(|e| e.to_string())
}

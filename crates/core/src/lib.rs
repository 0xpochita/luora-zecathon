pub mod checks;
pub mod decode;
pub mod model;
pub mod network;
pub mod pczt_view;
pub mod trace;
pub mod zip318;
#[cfg(feature = "verify")]
pub mod verify;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use model::*;
pub use network::Net;

pub fn decode_tx(hex: &str, network: &str) -> Result<DecodedTx, CoreError> {
    decode::decode(&decode::hex_to_bytes(hex)?, Net::parse(network)?)
}

pub fn check_tx(
    hex: &str,
    network: &str,
    height: u32,
    transparent_input_values_zat: &[Option<u64>],
) -> Result<Vec<Check>, CoreError> {
    checks::run_checks(
        &decode::hex_to_bytes(hex)?,
        Net::parse(network)?,
        height,
        transparent_input_values_zat,
    )
}

pub fn fee_zat(hex: &str, transparent_input_values_zat: &[Option<u64>]) -> Result<Option<u64>, CoreError> {
    decode::fee_zat(&decode::hex_to_bytes(hex)?, transparent_input_values_zat)
}

pub fn inspect_pczt(base64_or_hex: &str, network: &str) -> Result<PcztView, CoreError> {
    pczt_view::inspect(base64_or_hex, Net::parse(network)?)
}

pub fn trace_tx(hex: &str, network: &str) -> Result<Vec<TraceNode>, CoreError> {
    trace::trace(&decode::hex_to_bytes(hex)?, Net::parse(network)?)
}

pub fn zip318_tx(hex: &str, network: &str, height: u32) -> Result<Zip318View, CoreError> {
    zip318::zip318_view(&decode::hex_to_bytes(hex)?, Net::parse(network)?, height)
}

pub fn upgrade_at(network: &str, height: u32) -> Result<UpgradeInfo, CoreError> {
    Ok(network::upgrade_at(Net::parse(network)?, height))
}

#[cfg(feature = "verify")]
pub fn verify_tx(hex: &str) -> Result<verify::VerifyReport, CoreError> {
    verify::verify(&decode::hex_to_bytes(hex)?)
}

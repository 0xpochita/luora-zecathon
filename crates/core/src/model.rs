use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrchardLikeFlags {
    pub spends_enabled: bool,
    pub outputs_enabled: bool,
    pub cross_address_enabled: Option<bool>,
    pub reserved_bits_zero: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrchardLikeBundle {
    pub actions: usize,
    pub flags: OrchardLikeFlags,
    pub value_balance_zat: i64,
    pub anchor: String,
    pub proof_bytes: usize,
    pub canonical_proof_bytes: usize,
    pub nullifiers: Vec<String>,
    pub commitments: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransparentInput {
    pub prev_txid: String,
    pub prev_index: u32,
    pub script_sig_bytes: usize,
    pub sequence: u32,
    pub is_coinbase: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransparentOutput {
    pub value_zat: u64,
    pub script_pub_key: String,
    pub address: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct Transparent {
    pub inputs: Vec<TransparentInput>,
    pub outputs: Vec<TransparentOutput>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaplingBundle {
    pub spends: usize,
    pub outputs: usize,
    pub value_balance_zat: i64,
    pub anchor: Option<String>,
    pub proof_bytes_each: usize,
    pub nullifiers: Vec<String>,
    pub commitments: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Zip317 {
    pub logical_actions: usize,
    pub conventional_fee_zat: u64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DecodedTx {
    pub txid: String,
    pub version: u32,
    pub version_group_id: String,
    pub consensus_branch_id: Option<String>,
    pub upgrade: Option<String>,
    pub lock_time: u32,
    pub expiry_height: u32,
    pub size_bytes: usize,
    pub transparent: Transparent,
    pub sapling: Option<SaplingBundle>,
    pub orchard: Option<OrchardLikeBundle>,
    pub ironwood: Option<OrchardLikeBundle>,
    pub zip317: Zip317,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Pass,
    Fail,
    Warn,
    Na,
}

#[derive(Serialize, Debug, Clone)]
pub struct ZipRef {
    pub number: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clause: Option<String>,
    pub url: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct Check {
    pub id: String,
    pub title: String,
    pub status: CheckStatus,
    pub detail: String,
    pub zip: Option<ZipRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct PcztRole {
    pub name: &'static str,
    pub done: bool,
    pub evidence: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PcztAction {
    pub pool: &'static str,
    pub kind: &'static str,
    pub index: usize,
    pub value_zat: Option<u64>,
    pub recipient: Option<String>,
    pub user_address: Option<String>,
    pub proof: bool,
    pub signature: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct PcztView {
    pub roles: Vec<PcztRole>,
    pub actions: Vec<PcztAction>,
    pub checks: Vec<Check>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeInfo {
    pub name: String,
    pub branch_id: String,
    pub activation_height: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct CoreError {
    pub code: &'static str,
    pub message: String,
}

impl CoreError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CoreError {}

#[derive(Serialize, Debug, Clone)]
pub struct TraceField {
    pub name: String,
    pub value: String,
    pub display: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub encrypted: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TraceNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub depth: u32,
    pub kind: &'static str,
    pub label: String,
    pub offset: usize,
    pub length: usize,
    pub fields: Vec<TraceField>,
}

#[derive(Serialize, Debug, Clone)]
pub struct Zip318Reason {
    pub field: &'static str,
    pub ok: Option<bool>,
    pub detail: String,
    pub zip: ZipRef,
}

#[derive(Serialize, Debug, Clone)]
pub struct Zip318View {
    pub classification: &'static str,
    pub reasons: Vec<Zip318Reason>,
}

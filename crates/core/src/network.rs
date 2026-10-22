use zcash_protocol::consensus::{
    BlockHeight, BranchId, MAIN_NETWORK, NetworkType, NetworkUpgrade, Parameters, TEST_NETWORK,
};
use zcash_protocol::local_consensus::LocalNetwork;

use crate::model::{CoreError, UpgradeInfo};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Net {
    Main,
    Test,
    Regtest,
    MainWithNu7At(u32),
}

const REGTEST_ALL_UPGRADES_AT_HEIGHT_1: LocalNetwork = LocalNetwork {
    overwinter: Some(BlockHeight::from_u32(1)),
    sapling: Some(BlockHeight::from_u32(1)),
    blossom: Some(BlockHeight::from_u32(1)),
    heartwood: Some(BlockHeight::from_u32(1)),
    canopy: Some(BlockHeight::from_u32(1)),
    nu5: Some(BlockHeight::from_u32(1)),
    nu6: Some(BlockHeight::from_u32(1)),
    nu6_1: Some(BlockHeight::from_u32(1)),
    nu6_2: Some(BlockHeight::from_u32(1)),
    nu6_3: Some(BlockHeight::from_u32(1)),
    nu7: None,
};

impl Net {
    pub fn parse(name: &str) -> Result<Self, CoreError> {
        match name {
            "main" => Ok(Net::Main),
            "test" => Ok(Net::Test),
            "regtest" => Ok(Net::Regtest),
            other => Err(CoreError::new(
                "bad-network",
                format!("network must be \"main\", \"test\" or \"regtest\", got \"{other}\""),
            )),
        }
    }

    pub fn temporary_orchard_disabling_height(self) -> Option<u32> {
        match self {
            Net::Main | Net::MainWithNu7At(_) => Some(3_363_426),
            Net::Test => Some(4_048_500),
            Net::Regtest => None,
        }
    }
}

impl Parameters for Net {
    fn network_type(&self) -> NetworkType {
        match self {
            Net::Main | Net::MainWithNu7At(_) => NetworkType::Main,
            Net::Test => NetworkType::Test,
            Net::Regtest => NetworkType::Regtest,
        }
    }

    fn activation_height(&self, nu: NetworkUpgrade) -> Option<BlockHeight> {
        match self {
            Net::Main => MAIN_NETWORK.activation_height(nu),
            Net::Test => TEST_NETWORK.activation_height(nu),
            Net::Regtest => REGTEST_ALL_UPGRADES_AT_HEIGHT_1.activation_height(nu),
            Net::MainWithNu7At(height) if nu == NetworkUpgrade::Nu7 => Some(BlockHeight::from_u32(*height)),
            Net::MainWithNu7At(_) => MAIN_NETWORK.activation_height(nu),
        }
    }
}

pub fn upgrade_display_name(nu: NetworkUpgrade) -> String {
    nu.to_string().replacen("Nu", "NU", 1)
}

pub fn branch_display_name(branch: BranchId) -> String {
    branch
        .network_upgrade()
        .map(upgrade_display_name)
        .unwrap_or_else(|| "Sprout".to_string())
}

pub fn branch_hex(branch: BranchId) -> String {
    format!("0x{:08x}", u32::from(branch))
}

pub fn upgrade_at(net: Net, height: u32) -> UpgradeInfo {
    let height = BlockHeight::from_u32(height);
    let branch = BranchId::for_height(&net, height);
    let activation_height = branch
        .network_upgrade()
        .and_then(|nu| net.activation_height(nu))
        .map(u32::from)
        .unwrap_or(0);
    UpgradeInfo {
        name: branch_display_name(branch),
        branch_id: branch_hex(branch),
        activation_height,
    }
}

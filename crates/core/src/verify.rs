use std::fs::File;
use std::io::BufReader;
use std::time::Instant;

use bellman::gadgets::multipack;
use bls12_381::{Bls12, Scalar};
use group::Curve;
use orchard::circuit::VerifyingKey;
use serde::Serialize;

use crate::decode::{canonical_halo2_proof_bytes, parse_tx};
use crate::model::CoreError;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProofResult {
    pub pool: &'static str,
    pub system: &'static str,
    pub index: Option<usize>,
    pub kind: &'static str,
    pub proof_bytes: usize,
    pub valid: bool,
    pub detail: String,
    pub millis: u128,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub txid: String,
    pub proofs: Vec<ProofResult>,
    pub all_valid: bool,
    pub total_millis: u128,
}

struct SaplingKeys {
    spend: groth16::PreparedVerifyingKey<Bls12>,
    output: groth16::PreparedVerifyingKey<Bls12>,
}

fn load_sapling_keys() -> Result<SaplingKeys, CoreError> {
    let paths = zcash_proofs::download_sapling_parameters(Some(600)).map_err(|e| {
        CoreError::new(
            "sapling-params",
            format!("could not fetch or verify the Sapling parameters: {e}"),
        )
    })?;
    let read_vk = |path: &std::path::Path| -> Result<groth16::PreparedVerifyingKey<Bls12>, CoreError> {
        let file = File::open(path)
            .map_err(|e| CoreError::new("sapling-params", format!("{}: {e}", path.display())))?;
        let params = groth16::Parameters::<Bls12>::read(BufReader::new(file), false)
            .map_err(|e| CoreError::new("sapling-params", format!("{}: {e}", path.display())))?;
        Ok(groth16::prepare_verifying_key(&params.vk))
    };
    Ok(SaplingKeys {
        spend: read_vk(&paths.spend)?,
        output: read_vk(&paths.output)?,
    })
}

fn point_coordinates(bytes: [u8; 32]) -> Option<(Scalar, Scalar)> {
    let point: Option<jubjub::AffinePoint> = jubjub::AffinePoint::from_bytes(bytes).into();
    point.map(|p| (p.get_u(), p.get_v()))
}

fn groth16_check(
    pvk: &groth16::PreparedVerifyingKey<Bls12>,
    proof_bytes: &[u8],
    inputs: Option<Vec<Scalar>>,
) -> (bool, String) {
    let Some(inputs) = inputs else {
        return (false, "a public input is not a valid curve point or field element".to_string());
    };
    let proof = match groth16::Proof::<Bls12>::read(proof_bytes) {
        Ok(p) => p,
        Err(e) => return (false, format!("proof bytes do not decode: {e}")),
    };
    match groth16::verify_proof(pvk, &proof, &inputs) {
        Ok(()) => (true, "Groth16 proof verifies against the Sapling verifying key".to_string()),
        Err(e) => (false, format!("Groth16 verification failed: {e:?}")),
    }
}

fn sapling_spend_inputs(cv: [u8; 32], anchor: Scalar, nullifier: [u8; 32], rk: [u8; 32]) -> Option<Vec<Scalar>> {
    let (rk_u, rk_v) = point_coordinates(rk)?;
    let (cv_u, cv_v) = point_coordinates(cv)?;
    let packed = multipack::compute_multipacking(&multipack::bytes_to_bits_le(&nullifier));
    Some(vec![rk_u, rk_v, cv_u, cv_v, anchor, packed[0], packed[1]])
}

fn sapling_output_inputs(cv: [u8; 32], epk: [u8; 32], cmu: [u8; 32]) -> Option<Vec<Scalar>> {
    let (cv_u, cv_v) = point_coordinates(cv)?;
    let epk_point: Option<jubjub::AffinePoint> = jubjub::AffinePoint::from_bytes(epk).into();
    let epk_affine = jubjub::ExtendedPoint::from(epk_point?).to_affine();
    let cmu: Option<Scalar> = Scalar::from_bytes(&cmu).into();
    Some(vec![cv_u, cv_v, epk_affine.get_u(), epk_affine.get_v(), cmu?])
}

pub fn verify(bytes: &[u8]) -> Result<VerifyReport, CoreError> {
    let started = Instant::now();
    let tx = parse_tx(bytes)?;
    let mut proofs = vec![];

    for (pool, bundle) in [("orchard", tx.orchard_bundle()), ("ironwood", tx.ironwood_bundle())] {
        let Some(bundle) = bundle else { continue };
        let circuit = bundle.bundle_version().circuit_version();
        let key_started = Instant::now();
        let vk = VerifyingKey::build(circuit);
        let key_millis = key_started.elapsed().as_millis();
        let check_started = Instant::now();
        let result = bundle.verify_proof(&vk);
        let actions = bundle.actions().len();
        let proof_bytes = bundle.authorization().proof().as_ref().len();
        proofs.push(ProofResult {
            pool,
            system: "halo2",
            index: None,
            kind: "bundle",
            proof_bytes,
            valid: result.is_ok(),
            detail: match result {
                Ok(()) => format!(
                    "Halo 2 proof for {actions} actions verifies under the {circuit:?} circuit key (key built in {key_millis} ms; canonical size {} bytes)",
                    canonical_halo2_proof_bytes(actions)
                ),
                Err(e) => format!("Halo 2 verification under the {circuit:?} circuit key failed: {e:?}"),
            },
            millis: check_started.elapsed().as_millis(),
        });
    }

    if let Some(bundle) = tx.sapling_bundle() {
        let keys = load_sapling_keys()?;
        for (index, spend) in bundle.shielded_spends().iter().enumerate() {
            let t = Instant::now();
            let inputs = sapling_spend_inputs(
                spend.cv().to_bytes(),
                *spend.anchor(),
                spend.nullifier().0,
                (*spend.rk()).into(),
            );
            let (valid, detail) = groth16_check(&keys.spend, spend.zkproof(), inputs);
            proofs.push(ProofResult {
                pool: "sapling",
                system: "groth16",
                index: Some(index),
                kind: "spend",
                proof_bytes: spend.zkproof().len(),
                valid,
                detail,
                millis: t.elapsed().as_millis(),
            });
        }
        for (index, output) in bundle.shielded_outputs().iter().enumerate() {
            let t = Instant::now();
            let inputs = sapling_output_inputs(
                output.cv().to_bytes(),
                output.ephemeral_key().0,
                output.cmu().to_bytes(),
            );
            let (valid, detail) = groth16_check(&keys.output, output.zkproof(), inputs);
            proofs.push(ProofResult {
                pool: "sapling",
                system: "groth16",
                index: Some(index),
                kind: "output",
                proof_bytes: output.zkproof().len(),
                valid,
                detail,
                millis: t.elapsed().as_millis(),
            });
        }
    }

    Ok(VerifyReport {
        txid: tx.txid().to_string(),
        all_valid: proofs.iter().all(|p| p.valid),
        proofs,
        total_millis: started.elapsed().as_millis(),
    })
}

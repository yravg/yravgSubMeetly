//! Believing the update file, and the command that installs what it offers.
//!
//! Kept free of the app's own types (it uses only `poni_core`), so
//! `crates/poni-core/tests/update_feed.rs` can include this very file and run
//! its tests: the poni binary's own test target does not build.

use poni_core::update::{self, Release};

/// The file's text to the release it describes, once its signature checks out.
pub fn believe(text: &str) -> Result<Release, String> {
    let signed = update::parse_file(text)?;
    if !verify(signed.payload.as_bytes(), &signed.signature, &signed.key) {
        return Err("its signature doesn't match, so it was ignored".into());
    }
    update::parse_payload(&signed.payload)
}

/// The Setup `setup`, run silently: Inno Setup's switches. It closes a
/// running copy itself, keeps "Start with Windows" as the person set it, and
/// `/reopen` makes it start the new version when done
/// (installer/yravgsubmeetly.iss).
#[allow(dead_code)] // the Mac build has no Setup
pub fn setup_command(setup: &std::path::Path) -> std::process::Command {
    let mut c = std::process::Command::new(setup);
    c.args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/reopen"]);
    c
}

/// ECDSA P-256 over SHA-256: `signature` is r and s, `key` an uncompressed point.
#[cfg(windows)]
pub fn verify(message: &[u8], signature: &[u8; 64], key: &[u8; 65]) -> bool {
    use windows::Win32::Security::Cryptography::{
        BCryptCloseAlgorithmProvider, BCryptDestroyKey, BCryptImportKeyPair, BCryptOpenAlgorithmProvider, BCryptVerifySignature, BCRYPT_ALG_HANDLE,
        BCRYPT_ECCPUBLIC_BLOB, BCRYPT_ECDSA_P256_ALGORITHM, BCRYPT_ECDSA_PUBLIC_P256_MAGIC, BCRYPT_FLAGS, BCRYPT_KEY_HANDLE,
        BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS,
    };
    // BCRYPT_ECCKEY_BLOB: magic, key length, then X and Y.
    let mut blob = Vec::with_capacity(72);
    blob.extend_from_slice(&BCRYPT_ECDSA_PUBLIC_P256_MAGIC.to_le_bytes());
    blob.extend_from_slice(&32u32.to_le_bytes());
    blob.extend_from_slice(&key[1..]);
    let hash = poni_core::sha256::sha256(message);
    unsafe {
        let mut alg = BCRYPT_ALG_HANDLE::default();
        if BCryptOpenAlgorithmProvider(&mut alg, BCRYPT_ECDSA_P256_ALGORITHM, None, BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS(0)).is_err() {
            return false;
        }
        let mut handle = BCRYPT_KEY_HANDLE::default();
        let ok = BCryptImportKeyPair(alg, BCRYPT_KEY_HANDLE::default(), BCRYPT_ECCPUBLIC_BLOB, &mut handle, &blob, 0).is_ok()
            && BCryptVerifySignature(handle, None, &hash, signature, BCRYPT_FLAGS(0)).is_ok();
        if !handle.is_invalid() {
            let _ = BCryptDestroyKey(handle);
        }
        let _ = BCryptCloseAlgorithmProvider(alg, 0);
        ok
    }
}

/// ECDSA P-256 over SHA-256: `signature` is r and s, `key` an uncompressed point.
#[cfg(target_os = "macos")]
pub fn verify(message: &[u8], signature: &[u8; 64], key: &[u8; 65]) -> bool {
    use p256::ecdsa::signature::Verifier;
    use p256::ecdsa::{Signature, VerifyingKey};
    let (Ok(key), Ok(sig)) = (VerifyingKey::from_sec1_bytes(key), Signature::from_slice(signature)) else { return false };
    key.verify(message, &sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real file, signed with our update key (tools/make_update_feed.py --payload).
    const SAMPLE: &str = include_str!("../../../poni-core/data/update-sample.json");
    /// The same payload signed with a throwaway key that is NOT in update-keys.txt.
    const UNTRUSTED: &str = include_str!("../../../poni-core/data/update-sample-untrusted.json");
    /// The throwaway key's public half (uncompressed point).
    const THROWAWAY: &str = "0411ca45c499e3ea4d50237d34fda9318a73795e5f11e03b6824e08c63dcd36ec92dd9cc95fdb9e1dd15ce5f661074f4f6c05aa18a29dd7795ff4995fd74b77276";

    fn key_of(hex: &str) -> [u8; 65] {
        let b: Vec<u8> = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect();
        b.try_into().unwrap()
    }

    #[test]
    fn a_signed_file_is_believed() {
        let r = believe(SAMPLE).expect("the sample's signature checks out");
        assert_eq!((r.version.as_str(), r.headline.as_str()), ("0.2.3", "Sample release for the update tests"));
        assert_eq!(r.windows.as_ref().map(|d| d.size), Some(2457657));
    }

    #[test]
    fn a_changed_file_is_not() {
        // One character of the payload, or of the signature.
        let changed = SAMPLE.replacen("2457657", "2457658", 1);
        assert!(believe(&changed).unwrap_err().contains("signature"), "payload changed");
        let signed = update::parse_file(SAMPLE).unwrap();
        let mut sig = signed.signature;
        sig[10] ^= 1;
        assert!(!verify(signed.payload.as_bytes(), &sig, &signed.key));
        assert!(verify(signed.payload.as_bytes(), &signed.signature, &signed.key));
    }

    #[test]
    fn a_key_that_is_not_listed_is_not_believed() {
        // The throwaway key's signature is good, but the app trusts only its own list.
        let signed: serde_json::Value = serde_json::from_str(UNTRUSTED).unwrap();
        let sig = update::base64(signed["signature"].as_str().unwrap()).unwrap();
        let payload = signed["payload"].as_str().unwrap();
        assert!(verify(payload.as_bytes(), &sig.try_into().unwrap(), &key_of(THROWAWAY)), "the signature itself is good");
        assert!(believe(UNTRUSTED).unwrap_err().contains("doesn't trust"));
        // Naming our key on the throwaway's signature does not pass either.
        let forged = UNTRUSTED.replace(signed["key"].as_str().unwrap(), "ad662e29df0544ce");
        assert!(believe(&forged).unwrap_err().contains("signature"));
    }

    #[test]
    fn a_feed_pointing_outside_the_release_repo_is_not_believed() {
        // The signature over the original does not cover an edited payload, and a payload that
        // is signed but names another repository is refused by parse_payload on its own.
        let other = SAMPLE.replace("yraveragework/yraveragesub", "someone/else");
        assert!(believe(&other).is_err());
        let payload = update::parse_file(SAMPLE).unwrap().payload;
        assert!(update::parse_payload(&payload).is_ok());
        assert!(update::parse_payload(&payload.replace("yraveragework/yraveragesub", "someone/else")).is_err());
        assert!(update::FEED_URL.starts_with("https://github.com/yraveragework/yraveragesub/releases/"));
    }

    #[test]
    fn install_runs_the_setup_silently_and_reopens() {
        let c = setup_command(std::path::Path::new(r"C:\x\yravgSubMeetly-Setup-0.2.4.exe"));
        assert_eq!(c.get_program(), r"C:\x\yravgSubMeetly-Setup-0.2.4.exe");
        let args: Vec<_> = c.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/reopen"]);
    }
}

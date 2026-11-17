#[cfg(windows)]
pub(crate) fn protect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData};
    let input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(&input, windows::core::PCWSTR::null(), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .map_err(|e| e.to_string())?;
        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(encrypted)
    }
}

#[cfg(windows)]
pub(crate) fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData};
    let input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .map_err(|e| e.to_string())?;
        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(decrypted)
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub(crate) fn protect(_bytes: &[u8]) -> Result<Vec<u8>, String> { Err("加密存储仅支持 Windows 桌面版".into()) }

#[cfg(not(any(windows, target_os = "macos")))]
pub(crate) fn unprotect(_bytes: &[u8]) -> Result<Vec<u8>, String> { Err("读取加密数据仅支持 Windows 桌面版".into()) }

#[cfg(all(test, windows))]
mod tests {
    use super::{protect, unprotect};

    #[test]
    fn windows_user_can_decrypt_saved_credentials() {
        let plain = br#"{"username":"demo","password":"example"}"#;
        let encrypted = protect(plain).unwrap();
        assert_ne!(encrypted, plain);
        assert_eq!(unprotect(&encrypted).unwrap(), plain);
    }
}

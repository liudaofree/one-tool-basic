#[cfg(target_os = "macos")]
pub fn read(service: &str) -> Result<Option<Vec<u8>>, String> {
    use security_framework::passwords::PasswordOptions;
    match security_framework::passwords::generic_password(
        PasswordOptions::new_generic_password(service, "one-tool"),
    ) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(target_os = "macos")]
pub fn write(service: &str, value: &[u8]) -> Result<(), String> {
    security_framework::passwords::set_generic_password(service, "one-tool", value)
        .map_err(|error| error.to_string())
}

fn main() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-cr", "bin"])
            .status();
    }
    tauri_build::build()
}

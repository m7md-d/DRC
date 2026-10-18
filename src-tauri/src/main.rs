#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "macos")]
    if let Some(code) = drc_lib::mac_source::helper_entry() {
        std::process::exit(code);
    }
    drc_lib::run()
}

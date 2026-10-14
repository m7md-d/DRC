fn main() {
    println!(
        "cargo:rustc-env=DRC_BUILD_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build()
}

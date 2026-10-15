fn main() {
    println!(
        "cargo:rustc-env=DRC_BUILD_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
        && std::env::var_os("CARGO_FEATURE_MACOS_MENU_BAR").is_some()
    {
        build_native_menu();
    }
    tauri_build::build()
}

fn build_native_menu() {
    use std::{path::PathBuf, process::Command};
    let sources = ["native/MenuModels.swift", "native/MenuBar.swift"];
    for source in &sources {
        println!("cargo:rerun-if-changed={source}");
    }
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => panic!("Unsupported macOS architecture: {other}"),
    };
    let target = format!("{arch}-apple-macosx13.0");
    let sdk = Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-path"])
        .output()
        .expect("Xcode command line tools are required for the native menu");
    assert!(sdk.status.success(), "Cannot locate the macOS SDK");
    let sdk = String::from_utf8(sdk.stdout).unwrap().trim().to_owned();
    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-swift-version",
            "5",
            "-warnings-as-errors",
            "-target",
            &target,
            "-sdk",
            &sdk,
            "-O",
            "-parse-as-library",
            "-emit-library",
            "-static",
            "-module-name",
            "DRCNativeMenu",
        ])
        .arg("-module-cache-path")
        .arg(out.join("swift-module-cache"))
        .args(sources)
        .arg("-o")
        .arg(out.join("libdrc_native_menu.a"))
        .status()
        .expect("Cannot run the Swift compiler");
    assert!(
        status.success(),
        "Cannot compile the native SwiftUI menu bar"
    );
    let info = Command::new("xcrun")
        .args(["swiftc", "-print-target-info", "-target", &target])
        .output()
        .expect("Cannot read Swift runtime paths");
    assert!(info.status.success());
    let info: serde_json::Value = serde_json::from_slice(&info.stdout).unwrap();
    for path in info["paths"]["runtimeLibraryPaths"].as_array().unwrap() {
        println!("cargo:rustc-link-search=native={}", path.as_str().unwrap());
    }
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=drc_native_menu");
    for framework in ["AppKit", "SwiftUI", "Charts"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}

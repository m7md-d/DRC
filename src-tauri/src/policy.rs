use crate::{model::*, platform::identity_key, store::Store};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::{
    fs::{MetadataExt, OpenOptionsExt},
    io::AsRawFd,
};
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
};

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn protection_key(device: &Device) -> String {
    // Deliberately independent of BSD numbering/USB port. Identical descriptors may
    // receive the same conservative restriction; this is not a hardware identity.
    digest(
        serde_json::to_string(&serde_json::json!([
            device.name.trim(),
            device.size_bytes,
            device.info.get("DeviceBlockSize"),
            device.info.get("DiskUUID")
        ]))
        .unwrap_or_default()
        .as_bytes(),
    )
}

pub fn apply_protection(store: &Store, device: &mut Device) -> Result<(), String> {
    let key = protection_key(device);
    // The user's personal flash is explicitly authorized for metadata only.
    // Match broadly across reconnects so a port/partition change cannot unlock it.
    if (device.name.trim() == "SanDisk 3.2Gen1"
        && device.size_bytes.as_deref() == Some("494206451712"))
        || device.partitions.iter().any(|partition| {
            partition.get("VolumeUUID").and_then(Value::as_str)
                == Some("87AF25B8-16A1-3F34-8CCD-024004B0EA5A")
        })
    {
        store.protect(&key,"Personal flash: discovery and reported metadata only. Extended reads, file traversal and writes are prohibited.")?;
    }
    device.protection_reason = store.protection(&key)?;
    device.metadata_only = device.protection_reason.is_some();
    Ok(())
}

pub fn require_acquisition(device: &Device, fresh: &Value) -> Result<(), String> {
    if device.metadata_only {
        return Err(device
            .protection_reason
            .clone()
            .unwrap_or("This medium permits metadata only.".into()));
    }
    if device.internal != Some(false) {
        return Err("Physical acquisition requires a positively identified external medium. Internal/system media are excluded in this build.".into());
    }
    if device.info.is_null() || identity_key(fresh) != device.identity_key {
        return Err(
            "The source descriptor changed or is unavailable. Refresh and select it again.".into(),
        );
    }
    if fresh.get("WholeDisk") != Some(&Value::Bool(true))
        || !device
            .id
            .strip_prefix("disk")
            .is_some_and(|suffix| !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("Physical acquisition requires a whole physical disk, not a partition or synthesized volume.".into());
    }
    if device
        .size_bytes
        .as_deref()
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|s| *s > 0)
        .is_none()
    {
        return Err("The source has no valid nonzero reported capacity.".into());
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileIdentity {
    pub device: String,
    pub inode: String,
    pub size: String,
    pub modified_seconds: i64,
    pub modified_nanoseconds: i64,
}

pub fn file_identity(file: &File) -> Result<FileIdentity, String> {
    let m = file.metadata().map_err(|e| e.to_string())?;
    metadata_identity(&m)
}
pub fn path_identity(path: &Path) -> Result<FileIdentity, String> {
    metadata_identity(&std::fs::metadata(path).map_err(|e| e.to_string())?)
}
fn metadata_identity(m: &std::fs::Metadata) -> Result<FileIdentity, String> {
    #[cfg(unix)]
    return Ok(FileIdentity {
        device: m.dev().to_string(),
        inode: m.ino().to_string(),
        size: m.len().to_string(),
        modified_seconds: m.mtime(),
        modified_nanoseconds: m.mtime_nsec(),
    });
    #[cfg(not(unix))]
    {
        let _ = m;
        Err("Pinned file identity is not implemented on this host.".into())
    }
}

pub fn open_readonly(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    options.open(path).map_err(|e| format!("Cannot open source read-only: {e}. DRC does not elevate itself or change device permissions."))
}

pub fn existing_regular_source(path: &Path) -> Result<(PathBuf, File, FileIdentity), String> {
    if !path.is_absolute() || path.starts_with("/dev") {
        return Err("Choose a regular image file using an absolute path; device nodes cannot be passed as image files.".into());
    }
    if std::fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Source image symlinks are not accepted.".into());
    }
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if canonical.to_str().is_none() {
        return Err("The source path cannot be represented faithfully as UTF-8.".into());
    }
    let file = open_readonly(&canonical)?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("The source must be a regular, seekable image file.".into());
    }
    let identity = file_identity(&file)?;
    if identity.size == "0" {
        return Err("The source image is empty.".into());
    }
    Ok((canonical, file, identity))
}

pub fn available_bytes(directory: &File) -> Result<u64, String> {
    #[cfg(unix)]
    {
        let mut s = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        // SAFETY: fstatvfs initializes the provided struct on success; fd is owned.
        if unsafe { libc::fstatvfs(directory.as_raw_fd(), s.as_mut_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let s = unsafe { s.assume_init() };
        Ok((s.f_bavail as u64).saturating_mul(s.f_frsize))
    }
    #[cfg(not(unix))]
    {
        let _ = directory;
        Err("Destination capacity checking is not implemented on this host.".into())
    }
}

pub fn require_image_capacity(directory: &File, size: u64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut filesystem = std::mem::MaybeUninit::<libc::statfs>::uninit();
        if unsafe { libc::fstatfs(directory.as_raw_fd(), filesystem.as_mut_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let filesystem = unsafe { filesystem.assume_init() };
        let kind = unsafe { std::ffi::CStr::from_ptr(filesystem.f_fstypename.as_ptr()) }
            .to_str()
            .map_err(|e| e.to_string())?;
        if kind == "msdos" && size > u32::MAX as u64 {
            return Err("This destination is an MS-DOS/FAT filesystem; the planned image exceeds its 4 GiB minus one byte file limit.".into());
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (directory, size);
    }
    Ok(())
}

pub fn physical_stores(info: &Value) -> Result<Vec<String>, String> {
    if let Some(stores) = info.get("APFSPhysicalStores").and_then(Value::as_array) {
        let ids: Vec<_> = stores
            .iter()
            .filter_map(|s| {
                s.as_str()
                    .or_else(|| s.get("DeviceIdentifier").and_then(Value::as_str))
                    .or_else(|| s.get("APFSPhysicalStore").and_then(Value::as_str))
            })
            .map(whole_disk)
            .collect::<Result<_, _>>()?;
        if ids.len() != stores.len() {
            return Err("An APFS physical store could not be resolved.".into());
        }
        if !ids.is_empty() {
            return Ok(ids);
        }
    }
    if string_field(info, "FilesystemType").as_deref() == Some("apfs") {
        return Err("APFS physical stores were not reported; the path is ambiguous.".into());
    }
    if let Some(parent) = string_field(info, "ParentWholeDisk") {
        return Ok(vec![whole_disk(&parent)?]);
    }
    if info.get("WholeDisk") == Some(&Value::Bool(true)) {
        return Ok(vec![whole_disk(
            &string_field(info, "DeviceIdentifier").ok_or("Volume identity is missing")?,
        )?]);
    }
    Err("The physical backing of this path could not be established. DRC refuses an ambiguous source or destination.".into())
}

fn whole_disk(id: &str) -> Result<String, String> {
    if !crate::query::valid_device_id(id) {
        return Err("Invalid physical store identifier".into());
    }
    Ok(format!(
        "disk{}",
        id[4..].split('s').next().unwrap_or_default()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn medium() -> Device {
        let info = serde_json::json!({"DeviceIdentifier":"disk4","DeviceTreePath":"usb-port-one","MediaName":"SanDisk 3.2Gen1","TotalSize":"494206451712","DeviceBlockSize":"512","Internal":false,"WholeDisk":true});
        Device {
            id: "disk4".into(),
            token: "1:disk4".into(),
            identity_key: identity_key(&info),
            name: "SanDisk 3.2Gen1".into(),
            size_bytes: Some("494206451712".into()),
            internal: Some(false),
            protocol: Some("USB".into()),
            content: None,
            partitions: vec![],
            info,
            layout: Value::Null,
            info_error: None,
            observed_at: 1,
            metadata_only: false,
            protection_reason: None,
        }
    }
    #[test]
    fn personal_flash_remains_metadata_only_after_number_and_port_changes() {
        let root = std::env::temp_dir().join(crate::model::unique_id("drc-protection-test"));
        let store = Store::open(&root).unwrap();
        let mut first = medium();
        apply_protection(&store, &mut first).unwrap();
        assert!(first.metadata_only);
        assert!(require_acquisition(&first, &first.info).is_err());
        let mut reconnect = medium();
        reconnect.id = "disk9".into();
        reconnect.token = "2:disk9".into();
        reconnect.info["DeviceIdentifier"] = serde_json::json!("disk9");
        reconnect.info["DeviceTreePath"] = serde_json::json!("usb-port-two");
        reconnect.identity_key = identity_key(&reconnect.info);
        assert_eq!(protection_key(&first), protection_key(&reconnect));
        apply_protection(&store, &mut reconnect).unwrap();
        assert!(reconnect.metadata_only);
        assert!(require_acquisition(&reconnect, &reconnect.info).is_err());
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn physical_admission_rejects_internal_unknown_and_changed_sources() {
        let mut device = medium();
        device.name = "Test external medium".into();
        assert!(require_acquisition(&device, &device.info).is_ok());
        device.internal = Some(true);
        assert!(require_acquisition(&device, &device.info).is_err());
        device.internal = None;
        assert!(require_acquisition(&device, &device.info).is_err());
        device.internal = Some(false);
        let mut changed = device.info.clone();
        changed["TotalSize"] = serde_json::json!("1");
        assert!(require_acquisition(&device, &changed).is_err());
    }
    #[test]
    fn resolves_multiple_apfs_stores_and_rejects_unknown_backing() {
        let info = serde_json::json!({"APFSPhysicalStores":[{"DeviceIdentifier":"disk1s2"},{"DeviceIdentifier":"disk2s2"}]});
        assert_eq!(physical_stores(&info).unwrap(), ["disk1", "disk2"]);
        assert_eq!(physical_stores(&serde_json::json!({"FilesystemType":"apfs","APFSPhysicalStores":[{"APFSPhysicalStore":"disk0s2"}]})).unwrap(),["disk0"]);
        assert!(physical_stores(
            &serde_json::json!({"FilesystemType":"apfs","ParentWholeDisk":"disk3"})
        )
        .is_err());
        assert!(physical_stores(&serde_json::json!({"DeviceIdentifier":"disk9"})).is_err());
    }
    #[test]
    fn symlink_and_device_nodes_are_never_image_sources() {
        assert!(existing_regular_source(Path::new("/dev/disk0")).is_err());
        assert!(existing_regular_source(Path::new("relative.img")).is_err());
    }
}

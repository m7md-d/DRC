use crate::model::{now_ms, CommandRecord};
use base64::Engine;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

static NEXT_COMMAND: AtomicU64 = AtomicU64::new(1);

#[derive(Debug)]
pub enum ReadQuery {
    ListPhysical,
    LinuxList,
    LinuxInfo(String),
    LinuxProperties(String),
    LinuxConnections,
    LinuxPci,
    LinuxKernel,
    DeviceInfo(String),
    Connections,
    UsbRegistry,
    UsbHostPorts,
    UsbStorageServices,
    MediaRegistry,
    SmartInfo {
        executable: String,
        device: String,
        device_type: Option<String>,
    },
}

pub fn valid_device_id(id: &str) -> bool {
    if id.len() > 40 || !id.starts_with("disk") {
        return false;
    }
    let parts: Vec<&str> = id[4..].split('s').collect();
    !parts.is_empty()
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
}

impl ReadQuery {
    pub fn command(&self) -> Result<(String, Vec<String>), String> {
        let command = match self {
            Self::LinuxPci => ("/usr/bin/lspci".into(), vec!["-nnk".into()]),
            Self::LinuxKernel => ("/usr/bin/dmesg".into(), vec!["--json".into()]),
            Self::LinuxList => (
                "/usr/bin/lsblk".into(),
                vec![
                    "--json".into(),
                    "--bytes".into(),
                    "--output".into(),
                    crate::linux::COLUMNS.into(),
                ],
            ),
            Self::LinuxInfo(id) if crate::linux::valid_id(id) => (
                "/usr/bin/lsblk".into(),
                vec![
                    "--json".into(),
                    "--bytes".into(),
                    "--output".into(),
                    crate::linux::COLUMNS.into(),
                    "--".into(),
                    format!("/dev/{id}"),
                ],
            ),
            Self::LinuxProperties(id) if crate::linux::valid_id(id) => (
                "/usr/bin/udevadm".into(),
                vec![
                    "info".into(),
                    "--query=property".into(),
                    format!("--name=/dev/{id}"),
                ],
            ),
            Self::LinuxConnections => ("/usr/bin/lsusb".into(), vec!["-t".into()]),
            Self::ListPhysical => (
                "/usr/sbin/diskutil".into(),
                vec!["list".into(), "-plist".into(), "physical".into()],
            ),
            Self::DeviceInfo(id) if valid_device_id(id) => (
                "/usr/sbin/diskutil".into(),
                vec!["info".into(), "-plist".into(), id.clone()],
            ),
            Self::Connections => (
                "/usr/sbin/system_profiler".into(),
                vec![
                    "-json".into(),
                    "SPUSBDataType".into(),
                    "SPThunderboltDataType".into(),
                    "SPNVMeDataType".into(),
                ],
            ),
            Self::UsbRegistry => (
                "/usr/sbin/ioreg".into(),
                vec!["-a".into(), "-p".into(), "IOUSB".into(), "-l".into()],
            ),
            Self::UsbHostPorts => (
                "/usr/sbin/ioreg".into(),
                vec![
                    "-a".into(),
                    "-r".into(),
                    "-c".into(),
                    "AppleUSBHostPort".into(),
                    "-l".into(),
                ],
            ),
            Self::UsbStorageServices => (
                "/usr/sbin/ioreg".into(),
                vec![
                    "-a".into(),
                    "-r".into(),
                    "-c".into(),
                    "IOUSBHostDevice".into(),
                    "-l".into(),
                ],
            ),
            Self::MediaRegistry => (
                "/usr/sbin/ioreg".into(),
                vec![
                    "-a".into(),
                    "-r".into(),
                    "-c".into(),
                    "IOMedia".into(),
                    "-l".into(),
                ],
            ),
            Self::SmartInfo {
                executable,
                device,
                device_type,
            } if (if cfg!(target_os = "linux") {
                crate::linux::valid_id(device)
            } else {
                valid_device_id(device)
            }) && allowed_smart_path(executable)
                && valid_smart_type(device_type.as_deref()) =>
            {
                let mut arguments = vec!["-a".into(), "-j".into()];
                if let Some(kind) = device_type.as_deref().filter(|kind| *kind != "auto") {
                    arguments.extend(["-d".into(), kind.into()]);
                }
                arguments.push(format!("/dev/{device}"));
                (executable.clone(), arguments)
            }
            _ => {
                return Err(
                    "The metadata query has an invalid device identifier or executable.".into(),
                )
            }
        };
        Ok(command)
    }
}

pub fn valid_smart_type(kind: Option<&str>) -> bool {
    matches!(
        kind,
        None | Some("auto" | "sat" | "scsi" | "nvme" | "sntasmedia" | "sntjmicron" | "sntrealtek")
    )
}

pub fn allowed_smart_path(path: &str) -> bool {
    matches!(
        path,
        "/opt/homebrew/bin/smartctl"
            | "/usr/local/bin/smartctl"
            | "/usr/bin/smartctl"
            | "/usr/sbin/smartctl"
    )
}

pub fn execute(query: ReadQuery) -> Result<CommandRecord, String> {
    let (program, arguments) = query.command()?;
    let started_at = now_ms();
    let start = Instant::now();
    let mut record = CommandRecord {
        id: format!(
            "query-{started_at}-{}",
            NEXT_COMMAND.fetch_add(1, Ordering::Relaxed)
        ),
        program: program.clone(),
        arguments: arguments.clone(),
        started_at,
        duration_ms: 0,
        exit_code: None,
        timed_out: false,
        stdout: String::new(),
        stderr: String::new(),
        stdout_base64: String::new(),
        stderr_base64: String::new(),
        stdout_utf8_valid: true,
        stderr_utf8_valid: true,
        launch_error: None,
        stdout_artifact: None,
        termination_signal: None,
        stdin: None,
    };
    let child = Command::new(&program)
        .args(&arguments)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(error) => {
            record.launch_error = Some(error.to_string());
            return Ok(record);
        }
    };
    let mut stdout = child.stdout.take().ok_or("Missing stdout pipe")?;
    let mut stderr = child.stderr.take().ok_or("Missing stderr pipe")?;
    // Drain both streams while the child runs; a large stderr must not deadlock stdout.
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let timeout = if matches!(query, ReadQuery::Connections) {
        Duration::from_secs(45)
    } else {
        Duration::from_secs(15)
    };
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                record.exit_code = status.code();
                #[cfg(unix)]
                {
                    use std::os::unix::process::ExitStatusExt;
                    record.termination_signal = status.signal();
                }
                break;
            }
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                record.timed_out = true;
                let _ = child.kill();
                if let Ok(status) = child.wait() {
                    record.exit_code = status.code();
                    #[cfg(unix)]
                    {
                        use std::os::unix::process::ExitStatusExt;
                        record.termination_signal = status.signal();
                    }
                }
                break;
            }
            Err(error) => {
                record.launch_error = Some(error.to_string());
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    let stdout = out
        .join()
        .map_err(|_| "stdout reader failed")?
        .map_err(|e| e.to_string())?;
    let stderr = err
        .join()
        .map_err(|_| "stderr reader failed")?
        .map_err(|e| e.to_string())?;
    record.duration_ms = start.elapsed().as_millis() as u64;
    record.stdout_utf8_valid = std::str::from_utf8(&stdout).is_ok();
    record.stderr_utf8_valid = std::str::from_utf8(&stderr).is_ok();
    record.stdout = String::from_utf8_lossy(&stdout).into_owned();
    record.stderr = String::from_utf8_lossy(&stderr).into_owned();
    record.stdout_base64 = base64::engine::general_purpose::STANDARD.encode(stdout);
    record.stderr_base64 = base64::engine::general_purpose::STANDARD.encode(stderr);
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_options_shell_injection_and_incomplete_device_ids() {
        for bad in [
            "disk",
            "disk1;whoami",
            "disk1 s2",
            "/dev/disk1",
            "disk1s",
            "disk1ss2",
            "disk1\n",
            "--help",
            "disk1/../../",
        ] {
            assert!(!valid_device_id(bad), "accepted {bad:?}");
            assert!(ReadQuery::DeviceInfo(bad.into()).command().is_err());
        }
        for valid in ["disk0", "disk12", "disk4s1", "disk1s2s3"] {
            assert!(valid_device_id(valid));
        }
    }

    #[test]
    fn smart_request_has_fixed_read_information_flags_and_trusted_executable() {
        let query = ReadQuery::SmartInfo {
            executable: "/opt/homebrew/bin/smartctl".into(),
            device: "disk3".into(),
            device_type: None,
        };
        assert_eq!(query.command().unwrap().1, ["-a", "-j", "/dev/disk3"]);
        let rogue = ReadQuery::SmartInfo {
            executable: "/tmp/smartctl".into(),
            device: "disk3".into(),
            device_type: None,
        };
        assert!(rogue.command().is_err());
        for kind in [
            "auto",
            "sat",
            "scsi",
            "nvme",
            "sntasmedia",
            "sntjmicron",
            "sntrealtek",
        ] {
            let mode = ReadQuery::SmartInfo {
                executable: "/opt/homebrew/bin/smartctl".into(),
                device: "disk3".into(),
                device_type: Some(kind.into()),
            };
            let (_, args) = mode.command().unwrap();
            assert_eq!(&args[..2], ["-a", "-j"]);
            assert_eq!(args.last().unwrap(), "/dev/disk3");
            if kind != "auto" {
                assert_eq!(&args[2..4], ["-d", kind]);
            }
        }
        for kind in [
            "",
            "sat --set=security",
            "sntjmicron,0xffffffff",
            "-t",
            "auto\n",
            "nvme;reset",
        ] {
            let mode = ReadQuery::SmartInfo {
                executable: "/opt/homebrew/bin/smartctl".into(),
                device: "disk3".into(),
                device_type: Some(kind.into()),
            };
            assert!(mode.command().is_err());
        }
    }
}

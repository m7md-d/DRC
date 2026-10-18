//! Explicit source preparation, separate from read-only acquisition.
use crate::{model::CommandRecord, query};

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MountedVolume {
    pub device_id: String,
    pub mount_point: String,
    pub read_only: bool,
}

pub fn unmount_command(id: &str) -> Result<(String, Vec<String>), String> {
    if !id.strip_prefix("disk").is_some_and(|suffix| {
        !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        return Err("Unmount requires a validated whole macOS disk identifier.".into());
    }
    Ok((
        "/usr/sbin/diskutil".into(),
        vec!["unmountDisk".into(), format!("/dev/{id}")],
    ))
}

fn unmount_result(record: &CommandRecord) -> Result<(), String> {
    if record.exit_code == Some(0) && !record.timed_out && record.launch_error.is_none() {
        return Ok(());
    }
    Err(format!(
        "Source unmount did not complete (exit: {:?}, signal: {:?}, timed out: {}). {}\n{}\n{}\nClose files on the source, then retry. No forced unmount was attempted. Recheck the source before copying.",
        record.exit_code,
        record.termination_signal,
        record.timed_out,
        record.launch_error.as_deref().unwrap_or(""),
        record.stdout,
        record.stderr,
    ))
}

pub fn unmount(id: &str, emit: &mut dyn FnMut(CommandRecord)) -> Result<(), String> {
    let (program, arguments) = unmount_command(id)?;
    let record = query::execute_process(
        program,
        arguments,
        std::time::Duration::from_secs(60),
        None,
        &std::sync::atomic::AtomicBool::new(false),
        &mut || {},
    )?;
    let result = unmount_result(&record);
    emit(record);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unmount_is_whole_disk_only_without_force_or_eject() {
        for bad in [
            "",
            "disk",
            "disk8s4",
            "/dev/disk8",
            "disk8;id",
            "disk8\n",
            "--force",
        ] {
            assert!(unmount_command(bad).is_err());
        }
        assert_eq!(
            unmount_command("disk8").unwrap(),
            (
                "/usr/sbin/diskutil".into(),
                vec!["unmountDisk".into(), "/dev/disk8".into()]
            )
        );
    }

    #[test]
    fn refusal_and_partial_unmount_keep_original_output_and_do_not_report_success() {
        let mut record = query::execute_process(
            "/usr/bin/true".into(),
            vec![],
            std::time::Duration::from_secs(2),
            None,
            &std::sync::atomic::AtomicBool::new(false),
            &mut || {},
        )
        .unwrap();
        assert!(unmount_result(&record).is_ok());
        record.exit_code = Some(1);
        record.stdout = "Volume A unmounted".into();
        record.stderr = "Unmount failed for disk8: -69888; PID 42".into();
        let error = unmount_result(&record).unwrap_err();
        assert!(error.contains("Volume A unmounted"));
        assert!(error.contains("-69888; PID 42"));
        record.exit_code = Some(0);
        record.timed_out = true;
        assert!(unmount_result(&record).is_err());
        record.timed_out = false;
        record.launch_error = Some("Permission denied (os error 13)".into());
        assert!(unmount_result(&record).unwrap_err().contains("os error 13"));
    }
}

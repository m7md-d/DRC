use crate::{
    acquisition::decimal,
    model::{now_ms, unique_id, CommandRecord},
    policy::{self, FileIdentity},
};
use base64::Engine;
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::{io::AsRawFd, process::CommandExt};
use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSource {
    pub token: String,
    pub path: String,
    pub identity: FileIdentity,
    pub opened_at: u64,
}
struct OpenImage {
    source: ImageSource,
    input: File,
}
#[derive(Default)]
pub struct Manager {
    source: Mutex<Option<OpenImage>>,
    reports: Mutex<HashMap<String, Report>>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub sector_size: u32,
    pub offset_sectors: String,
    pub filesystem: Option<String>,
    pub utc: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Partitions,
    Filesystem,
    Directory,
    Metadata,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub token: String,
    pub action: Action,
    pub geometry: Geometry,
    pub inode: Option<String>,
    pub entries: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub inode: String,
    pub kind: String,
    pub name: String,
    pub deleted: bool,
    pub prefix: String,
    pub modified: String,
    pub accessed: String,
    pub changed: String,
    pub created: String,
    pub size: String,
    pub uid: String,
    pub gid: String,
    pub original_line: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionEntry {
    pub row: String,
    pub slot: String,
    pub start: String,
    pub end: String,
    pub length: String,
    pub description: String,
    pub original_line: String,
    pub fields: serde_json::Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: String,
    pub source: ImageSource,
    pub request: Request,
    pub record: CommandRecord,
    pub files: Vec<FileEntry>,
    pub partitions: Vec<PartitionEntry>,
    pub unparsed_lines: Vec<String>,
    pub warnings: Vec<String>,
    pub fields: Option<serde_json::Value>,
}

pub fn executable() -> Result<String, String> {
    let packaged = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("drc-tsk")));
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(concat!("drc-tsk-", env!("DRC_BUILD_TARGET")));
    packaged
        .into_iter()
        .chain(std::iter::once(development))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or(
            "The pinned image adapter is unavailable. Install The Sleuth Kit and rebuild DRC."
                .into(),
        )
}
pub fn valid_inode(value: &str) -> bool {
    value.len() <= 64
        && (1..=3).contains(&value.split('-').count())
        && value.split('-').all(|p| {
            !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) && p.parse::<u64>().is_ok()
        })
}
fn validate(geometry: &Geometry, total: &str) -> Result<(), String> {
    if ![512, 1024, 2048, 4096].contains(&geometry.sector_size) {
        return Err("Unsupported logical sector size".into());
    }
    if decimal(&geometry.offset_sectors, "Filesystem sector offset")?
        .checked_mul(u64::from(geometry.sector_size))
        .filter(|p| *p < decimal(total, "Image size").unwrap_or(0))
        .is_none()
    {
        return Err("Filesystem offset is outside the image.".into());
    }
    if geometry.filesystem.as_deref().is_some_and(|f| {
        ![
            "ntfs", "fat", "fat12", "fat16", "fat32", "exfat", "ext", "ext2", "ext3", "ext4",
            "ufs", "ufs1", "ufs2", "hfs", "hfsp", "hfsl", "apfs", "iso9660", "yaffs2",
        ]
        .contains(&f)
    }) {
        return Err(
            "Unrecognized filesystem adapter. Host directory readers are prohibited.".into(),
        );
    }
    Ok(())
}
pub fn arguments(
    request: &Request,
    input: &str,
    total: &str,
) -> Result<(String, Vec<String>), String> {
    validate(&request.geometry, total)?;
    if request.inode.as_deref().is_some_and(|n| !valid_inode(n)) {
        return Err("Invalid metadata address.".into());
    }
    if !["all", "allocated", "deleted"].contains(&request.entries.as_str()) {
        return Err("Unrecognized directory-entry filter.".into());
    }
    let name = match request.action {
        Action::Partitions => "partitions",
        Action::Filesystem => "fsstat",
        Action::Directory => "fls",
        Action::Metadata => "istat",
    };
    let descriptor = input
        .strip_prefix("/dev/fd/")
        .filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        .ok_or("An inherited image descriptor is required.")?;
    if matches!(request.action, Action::Metadata) && request.inode.is_none() {
        return Err("Select a metadata address.".into());
    }
    let args = vec![
        name.into(),
        descriptor.into(),
        request.geometry.sector_size.to_string(),
        request.geometry.offset_sectors.clone(),
        request.geometry.filesystem.clone().unwrap_or("auto".into()),
        request.entries.clone(),
        request.inode.clone().unwrap_or("root".into()),
    ];
    Ok((executable()?, args))
}

impl Manager {
    pub fn open(&self, path: &Path) -> Result<ImageSource, String> {
        let (path, input, identity) = policy::existing_regular_source(path)?;
        if decimal(&identity.size, "Image size")? == 0 {
            return Err("The image is empty.".into());
        }
        let source = ImageSource {
            token: unique_id("image"),
            path: path.to_string_lossy().into_owned(),
            identity,
            opened_at: now_ms(),
        };
        *self.source.lock().map_err(|e| e.to_string())? = Some(OpenImage {
            source: source.clone(),
            input,
        });
        self.reports.lock().map_err(|e| e.to_string())?.clear();
        Ok(source)
    }
    pub fn close(&self) -> Result<(), String> {
        *self.source.lock().map_err(|e| e.to_string())? = None;
        self.reports.lock().map_err(|e| e.to_string())?.clear();
        Ok(())
    }
    pub fn query(&self, request: Request) -> Result<Report, String> {
        let source = self.source.lock().map_err(|e| e.to_string())?;
        let opened = source
            .as_ref()
            .filter(|s| s.source.token == request.token)
            .ok_or("The image selection expired. Open it again.")?;
        if policy::file_identity(&opened.input)? != opened.source.identity {
            return Err("The source image changed. Open and inspect it again.".into());
        }
        let record = run_read(&opened.input, &request, &opened.source.identity.size)?;
        let mut report = Report {
            id: unique_id("image-report"),
            source: opened.source.clone(),
            request,
            record,
            files: Vec::new(),
            partitions: Vec::new(),
            unparsed_lines: Vec::new(),
            warnings: Vec::new(),
            fields: None,
        };
        if policy::file_identity(&opened.input)? != opened.source.identity {
            report.warnings.push("The source image changed during this query. Original output is retained as an observation of a changing source.".into());
        }
        if !report.record.stdout_utf8_valid {
            report.warnings.push("Output is not valid UTF-8. Original bytes are retained; no directory or partition rows are interpreted.".into());
            return Ok(report);
        }
        match report.request.action {
            Action::Directory => {
                let (rows, unparsed) = parse_files(&report.record.stdout);
                report.files = rows;
                report.unparsed_lines = unparsed;
            }
            Action::Partitions => {
                match serde_json::from_str::<serde_json::Value>(&report.record.stdout) {
                    Ok(fields) => {
                        report.partitions=fields.get("partitions").and_then(|v|v.as_array()).into_iter().flatten().filter_map(|p| {
                            let get=|key| p.get(key).and_then(|v|v.as_str()).map(str::to_owned);
                            let start=get("start")?;let length=get("length")?;
                            let end=decimal(&start,"Start").ok()?.checked_add(decimal(&length,"Length").ok()?.saturating_sub(1))?.to_string();
                            Some(PartitionEntry{row:get("address")?,slot:format!("{}:{}",get("tableNumber")?,get("slotNumber")?),start,end,length,description:get("description")?,original_line:p.to_string(),fields:p.clone()})
                        }).collect();
                        let source_count = fields.get("partitions").and_then(|v|v.as_array()).map_or(0, Vec::len);
                        if source_count != report.partitions.len() { report.warnings.push(format!("{} volume rows could not be represented as table entries. All original fields are retained.", source_count - report.partitions.len())); }
                        report.fields=Some(fields);
                    }
                    Err(error)=>report.warnings.push(format!("The adapter's volume report could not be parsed: {error}. Original bytes retained.")),
                }
            }
            _ => {}
        }
        if !report.unparsed_lines.is_empty() && matches!(report.request.action, Action::Directory) {
            report.warnings.push(format!("{} lines could not be represented as rows. They remain available unchanged in the original output.",report.unparsed_lines.len()));
        }
        self.reports
            .lock()
            .map_err(|e| e.to_string())?
            .insert(report.id.clone(), report.clone());
        Ok(report)
    }
    pub fn extraction_source(
        &self,
        report_id: &str,
        indices: &[usize],
    ) -> Result<(ImageSource, File, Request, Vec<FileEntry>), String> {
        let source = self.source.lock().map_err(|e| e.to_string())?;
        let opened = source.as_ref().ok_or("Open an image first.")?;
        let reports = self.reports.lock().map_err(|e| e.to_string())?;
        let report = reports
            .get(report_id)
            .filter(|r| {
                r.source.token == opened.source.token
                    && matches!(r.request.action, Action::Directory)
            })
            .ok_or("Run a fresh directory query before extracting files.")?;
        if indices.is_empty() || indices.len() > 1000 {
            return Err("Select between 1 and 1000 directory entries per extraction.".into());
        }
        let mut files = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for index in indices {
            if !seen.insert(index) {
                return Err("An entry was selected twice.".into());
            }
            let file = report
                .files
                .get(*index)
                .ok_or("The selected row is absent from the recorded directory query.")?;
            if matches!(file.kind.chars().next(), Some('d' | 'V')) {
                return Err("Browse directories and select their file entries. Directory recursion is not implicit.".into());
            }
            files.push(file.clone());
        }
        if policy::file_identity(&opened.input)? != opened.source.identity {
            return Err("The source image changed since opening.".into());
        }
        Ok((
            opened.source.clone(),
            opened.input.try_clone().map_err(|e| e.to_string())?,
            report.request.clone(),
            files,
        ))
    }
}
fn run_read(input: &File, request: &Request, total: &str) -> Result<CommandRecord, String> {
    #[cfg(not(unix))]
    {
        let _ = (input, request, total);
        return Err("Pinned image commands are not implemented on this host.".into());
    }
    #[cfg(unix)]
    {
        let fd = input.as_raw_fd();
        if unsafe { libc::fcntl(fd, libc::F_GETFL) } & libc::O_ACCMODE != libc::O_RDONLY {
            return Err("The source handle is not read only.".into());
        }
        let (program, args) = arguments(request, &format!("/dev/fd/{fd}"), total)?;
        let at = now_ms();
        let start = Instant::now();
        let mut record = CommandRecord {
            id: unique_id("image-query"),
            program: program.clone(),
            arguments: args.clone(),
            started_at: at,
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
        };
        let mut command = Command::new(program);
        command
            .args(args)
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if request.geometry.utc {
            command.env("TZ", "UTC");
        }
        // SAFETY: only the async-signal-safe fcntl call is made after fork.
        unsafe {
            command.pre_exec(move || {
                if libc::fcntl(fd, libc::F_SETFD, 0) != 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(e) => {
                record.launch_error = Some(e.to_string());
                return Ok(record);
            }
        };
        let mut stdout = child.stdout.take().ok_or("No image-query stdout")?;
        let mut stderr = child.stderr.take().ok_or("No image-query stderr")?;
        let out = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            stdout.read_to_end(&mut bytes).map(|_| bytes)
        });
        let err = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            stderr.read_to_end(&mut bytes).map(|_| bytes)
        });
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    record.exit_code = status.code();
                    break;
                }
                Ok(None) if start.elapsed() < Duration::from_secs(30) => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                Ok(None) => {
                    record.timed_out = true;
                    let _ = child.kill();
                    record.exit_code = child.wait().ok().and_then(|s| s.code());
                    break;
                }
                Err(e) => {
                    record.launch_error = Some(e.to_string());
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
        let out = out
            .join()
            .map_err(|_| "Image-query stdout reader failed")?
            .map_err(|e| e.to_string())?;
        let err = err
            .join()
            .map_err(|_| "Image-query stderr reader failed")?
            .map_err(|e| e.to_string())?;
        record.duration_ms = start.elapsed().as_millis() as u64;
        record.stdout_utf8_valid = std::str::from_utf8(&out).is_ok();
        record.stderr_utf8_valid = std::str::from_utf8(&err).is_ok();
        record.stdout = String::from_utf8_lossy(&out).into_owned();
        record.stderr = String::from_utf8_lossy(&err).into_owned();
        record.stdout_base64 = base64::engine::general_purpose::STANDARD.encode(out);
        record.stderr_base64 = base64::engine::general_purpose::STANDARD.encode(err);
        Ok(record)
    }
}
pub fn parse_files(output: &str) -> (Vec<FileEntry>, Vec<String>) {
    let mut entries = Vec::new();
    let mut unparsed = Vec::new();
    for line in output.lines().filter(|l| !l.is_empty()) {
        let cells: Vec<_> = line.split('\t').collect();
        let row = (|| -> Option<FileEntry> {
            if cells.len() < 9 {
                return None;
            }
            let prefix = cells[0];
            let tokens: Vec<_> = prefix.split_whitespace().collect();
            let kind = *tokens.first()?;
            if kind.len() != 3 || kind.as_bytes()[1] != b'/' {
                return None;
            }
            let address = tokens.last()?.trim_end_matches(':').split('(').next()?;
            if !valid_inode(address) || !prefix.ends_with(':') {
                return None;
            }
            let end = cells.len();
            let size = cells[end - 3];
            if !size.bytes().all(|b| b.is_ascii_digit()) || size.is_empty() {
                return None;
            }
            Some(FileEntry {
                inode: address.into(),
                kind: kind.into(),
                name: cells[1..end - 7].join("\t"),
                deleted: tokens.contains(&"*"),
                prefix: prefix.into(),
                modified: cells[end - 7].into(),
                accessed: cells[end - 6].into(),
                changed: cells[end - 5].into(),
                created: cells[end - 4].into(),
                size: size.into(),
                uid: cells[end - 2].into(),
                gid: cells[end - 1].into(),
                original_line: line.into(),
            })
        })();
        if let Some(row) = row {
            entries.push(row);
        } else {
            unparsed.push(line.into());
        }
    }
    (entries, unparsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(token: String, action: Action) -> Request {
        Request {
            token,
            action,
            geometry: Geometry {
                sector_size: 512,
                offset_sectors: "0".into(),
                filesystem: None,
                utc: true,
            },
            inode: None,
            entries: "all".into(),
        }
    }
    #[test]
    fn image_commands_reject_injected_addresses_and_host_directory_backends() {
        let mut r = request("test".into(), Action::Directory);
        for bad in [
            "-1",
            "4;ls",
            "5\n",
            "1--2",
            "1/../../",
            "18446744073709551616",
        ] {
            r.inode = Some(bad.into());
            assert!(arguments(&r, "/dev/fd/3", "8388608").is_err());
        }
        r.inode = Some("42-128-1".into());
        r.geometry.filesystem = Some("logical".into());
        assert!(arguments(&r, "/dev/fd/3", "8388608").is_err());
        r.geometry.filesystem = Some("ntfs".into());
        let (_, args) = arguments(&r, "/dev/fd/3", "8388608").unwrap();
        assert_eq!(args[0], "fls");
        assert!(!args.contains(&"-r".into()));
        r.geometry.offset_sectors = "18446744073709551615".into();
        assert!(arguments(&r, "/dev/fd/3", "8388608").is_err());
    }
    #[test]
    fn directory_parser_keeps_tabs_large_sizes_deleted_flags_and_opaque_prefixes() {
        let line="r/r * 42-128-1(realloc):\tname\twith tab\tmtime\tatime\tctime\tcrtime\t18446744073709551615\t-1\t0";
        let (rows, unparsed) = parse_files(&format!("{line}\nfuture syntax retained\n"));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].inode, "42-128-1");
        assert_eq!(rows[0].name, "name\twith tab");
        assert_eq!(rows[0].size, "18446744073709551615");
        assert_eq!(rows[0].original_line, line);
        assert!(rows[0].deleted);
        assert_eq!(unparsed, vec!["future syntax retained"]);
    }
    #[test]
    #[cfg(unix)]
    fn real_fat_images_browse_unicode_deleted_directories_and_partition_offsets_without_source_changes(
    ) {
        let root = std::env::temp_dir().join(unique_id("drc-fs-test"));
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/make_fat_fixture.py");
        assert!(Command::new("python3")
            .arg(script)
            .arg(&root)
            .stdout(Stdio::null())
            .status()
            .unwrap()
            .success());
        let image = root.join("fat16-volume.img");
        let original = std::fs::read(&image).unwrap();
        let manager = Manager::default();
        let source = manager.open(&image).unwrap();
        let root_report = manager
            .query(request(source.token.clone(), Action::Directory))
            .unwrap();
        assert_eq!(
            root_report.record.exit_code,
            Some(0),
            "{}",
            root_report.record.stderr
        );
        assert!(root_report.unparsed_lines.is_empty());
        assert!(root_report.files.iter().any(|f| f.name == "Recovery Ω.txt"));
        assert!(root_report
            .files
            .iter()
            .any(|f| f.deleted && f.inode == "5"));
        let mut directory = request(source.token.clone(), Action::Directory);
        directory.inode = Some("6".into());
        let nested = manager.query(directory).unwrap();
        assert!(nested
            .files
            .iter()
            .any(|f| f.name == "NESTED.BIN" && f.size == "1024"));
        let fs = manager
            .query(request(source.token, Action::Filesystem))
            .unwrap();
        assert_eq!(fs.record.exit_code, Some(0));
        assert!(fs.record.stdout.contains("FAT16"));
        assert_eq!(std::fs::read(&image).unwrap(), original);
        let disk = manager.open(&root.join("fat16-disk.img")).unwrap();
        let layout = manager
            .query(request(disk.token.clone(), Action::Partitions))
            .unwrap();
        assert!(layout.partitions.iter().any(|p| p.start == "2048"));
        let mut directory = request(disk.token, Action::Directory);
        directory.geometry.offset_sectors = "2048".into();
        let partition = manager.query(directory).unwrap();
        assert!(partition.files.iter().any(|f| f.name == "HELLO.TXT"));
        let nested_path = root.join("nested-volume-system.img");
        let mut nested = vec![0; 65536];
        nested.extend_from_slice(&std::fs::read(root.join("fat16-disk.img")).unwrap());
        std::fs::write(&nested_path, &nested).unwrap();
        let nested_source = manager.open(&nested_path).unwrap();
        let mut nested_request = request(nested_source.token, Action::Partitions);
        nested_request.geometry.offset_sectors = "128".into();
        let nested_report = manager.query(nested_request).unwrap();
        assert_eq!(nested_report.record.exit_code, Some(0));
        assert_eq!(
            nested_report.fields.as_ref().unwrap()["offsetBytes"],
            "65536"
        );
        assert!(nested_report.partitions.iter().any(|p| p.start == "2048"));
        manager.close().unwrap();
        assert!(manager.query(root_report.request).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}

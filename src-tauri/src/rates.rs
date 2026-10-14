use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateSample {
    pub line: usize,
    pub time_seconds: String,
    pub input_position: String,
    pub current_rate: String,
    pub average_rate: String,
    pub bad_areas: String,
    pub bad_bytes: String,
    pub values: Vec<String>,
    pub break_before: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateReport {
    pub attempt: u32,
    pub started_at: u64,
    pub path: String,
    pub raw: String,
    pub raw_base64: String,
    pub utf8_valid: bool,
    pub columns: Vec<String>,
    pub samples: Vec<RateSample>,
    pub warnings: Vec<String>,
    pub pending_line: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSample {
    pub elapsed_ms: String,
    pub observed_at: u64,
    pub rescued_bytes: String,
    pub non_tried_bytes: String,
    pub non_trimmed_bytes: String,
    pub non_scraped_bytes: String,
    pub bad_sector_bytes: String,
    pub domain_bytes: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressReport {
    pub attempt: u32,
    pub started_at: u64,
    pub samples: Vec<ProgressSample>,
}

pub fn report(attempt: u32, started_at: u64, path: String, bytes: &[u8], live: bool) -> RateReport {
    let mut result = RateReport {
        attempt,
        started_at,
        path,
        raw: String::from_utf8_lossy(bytes).into_owned(),
        raw_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        utf8_valid: std::str::from_utf8(bytes).is_ok(),
        columns: Vec::new(),
        samples: Vec::new(),
        warnings: Vec::new(),
        pending_line: live && !bytes.is_empty() && !bytes.ends_with(b"\n"),
    };
    if !result.utf8_valid {
        result.warnings.push("The rate log is not valid UTF-8. Original bytes are retained; no measurements are plotted.".into());
        return result;
    }
    let text = result.raw.clone();
    let mut interrupted = false;
    let mut previous = None;
    let lines: Vec<_> = text.lines().collect();
    for (index, line) in lines.iter().enumerate() {
        if result.pending_line && index + 1 == lines.len() {
            break;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(header) = line.strip_prefix("#Time") {
            result.columns = std::iter::once("Time".to_owned())
                .chain(header.split_whitespace().map(str::to_owned))
                .collect();
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        let cells: Vec<_> = line.split_whitespace().collect();
        let parsed = (|| -> Result<[u64; 6], String> {
            let expected = [
                "Time",
                "Ipos",
                "Current_rate",
                "Average_rate",
                "Bad_areas",
                "Bad_size",
            ];
            if result.columns.len() < 6
                || !result
                    .columns
                    .iter()
                    .take(6)
                    .map(String::as_str)
                    .eq(expected)
            {
                return Err("Unrecognized rate-log columns; original row retained.".into());
            }
            if cells.len() != result.columns.len() {
                return Err("Rate-log row has a different column count.".into());
            }
            let mut numbers = [0; 6];
            for (i, cell) in cells.iter().take(6).enumerate() {
                numbers[i] = if i == 1 && cell.starts_with("0x") {
                    u64::from_str_radix(&cell[2..], 16).map_err(|e| e.to_string())?
                } else if !cell.is_empty() && cell.bytes().all(|b| b.is_ascii_digit()) {
                    cell.parse()
                        .map_err(|e: std::num::ParseIntError| e.to_string())?
                } else {
                    return Err("Expected an unsigned integer measurement.".into());
                };
            }
            if previous.is_some_and(|p| numbers[0] < p) {
                return Err("Rate-log time moved backwards.".into());
            }
            Ok(numbers)
        })();
        match parsed {
            Ok(n) => {
                result.samples.push(RateSample {
                    line: index + 1,
                    time_seconds: n[0].to_string(),
                    input_position: n[1].to_string(),
                    current_rate: n[2].to_string(),
                    average_rate: n[3].to_string(),
                    bad_areas: n[4].to_string(),
                    bad_bytes: n[5].to_string(),
                    values: cells.iter().map(|v| (*v).to_owned()).collect(),
                    break_before: interrupted
                        || previous.is_some_and(|p| n[0].saturating_sub(p) > 1),
                });
                previous = Some(n[0]);
                interrupted = false;
            }
            Err(error) => {
                result.warnings.push(format!("Line {}: {error}", index + 1));
                interrupted = true;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    const HEADER: &str = "#Time Ipos Current_rate Average_rate Bad_areas Bad_size Vendor\n";
    #[test]
    fn retains_exact_counters_unknown_columns_and_original_bytes() {
        let bytes = format!("{HEADER}0 0xffffffffffffffff 18446744073709551615 0 0 0 opaque\n");
        let r = report(1, 123, "rates.log".into(), bytes.as_bytes(), false);
        assert_eq!(r.samples[0].input_position, "18446744073709551615");
        assert_eq!(r.samples[0].current_rate, "18446744073709551615");
        assert_eq!(r.samples[0].values[6], "opaque");
        assert_eq!(r.raw, bytes);
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(r.raw_base64)
                .unwrap(),
            bytes.as_bytes()
        );
    }
    #[test]
    fn missing_invalid_and_partial_rows_never_become_zero_measurements() {
        let bytes = format!("{HEADER}0 0x0 0 0 0 0 x\n1 0x1 invalid 2 0 0 x\n2 0x2 3 2 0 0 x\n4 0x4 5 4 0 0 x\n5 0x");
        let r = report(2, 123, "rates.log".into(), bytes.as_bytes(), true);
        assert!(r.pending_line);
        assert_eq!(r.samples.len(), 3);
        assert_eq!(r.warnings.len(), 1);
        assert!(r.samples[1].break_before && r.samples[2].break_before);
        assert!(
            report(2, 123, "rates.log".into(), bytes.as_bytes(), false)
                .warnings
                .len()
                > 1
        );
        assert!(report(1, 0, String::new(), b"0 0 0 0 0 0\n", false)
            .samples
            .is_empty());
        assert!(report(1, 0, String::new(), b"\xff", false)
            .samples
            .is_empty());
    }
}

//! Filesystem and acquisition contracts are independent of the host OS.
//! This build exposes metadata only; no reader or acquisition implementation is claimed here.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum BlockSource {
    Physical {
        session_token: String,
        logical_block_size: Option<String>,
    },
    Image {
        path: String,
        logical_block_size: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "state", content = "reason")]
pub enum Support {
    Available,
    NotImplemented,
    Unsupported(String),
    RequiresKey,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemCapabilities {
    pub filesystem: String,
    pub backend: String,
    pub inspect: Support,
    pub list: Support,
    pub extract: Support,
    pub undelete: Support,
    pub verify: Support,
    pub repair: Support,
    pub format: Support,
}

pub trait FilesystemBackend: Send + Sync {
    fn capabilities(&self) -> FilesystemCapabilities;
    fn inspect(&self, source: &BlockSource) -> Result<serde_json::Value, String>;
}

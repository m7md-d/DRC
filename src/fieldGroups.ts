import { flatten, type Field } from "./data";
import type { Json } from "./types";

const deviceGroups = [
  [
    "identity",
    "Identity",
    [
      "DeviceIdentifier",
      "DeviceNode",
      "DeviceTreePath",
      "IORegistryEntryName",
      "MediaName",
      "DiskUUID",
      "VolumeUUID",
      "SerialNumber",
      "BusName",
      "VirtualOrPhysical",
      "WholeDisk",
      "Internal",
      "PartOfWhole",
      "ParentWholeDisk",
      "OSInternalMedia",
    ],
  ],
  [
    "capacity",
    "Capacity & sectors",
    [
      "TotalSize",
      "DiskSize",
      "Size",
      "IOKitSize",
      "DeviceBlockSize",
      "AllocationBlockSize",
      "VolumeAllocationBlockSize",
      "VolumeSize",
      "VolumeFreeSpace",
      "FreeSpace",
      "APFSContainerSize",
      "APFSContainerFree",
      "APFSContainerReference",
      "APFSPhysicalStores",
      "APFSPhysicalStore",
      "APFSVolumeQuota",
      "APFSVolumeReserve",
    ],
  ],
  [
    "connection",
    "Connection & medium",
    [
      "BusProtocol",
      "Protocol",
      "SMARTStatus",
      "SolidState",
      "MediaType",
      "Removable",
      "RemovableMedia",
      "RemovableMediaOrExternalDevice",
      "Ejectable",
      "EjectableOnly",
      "EjectableMediaAutomaticUnderSoftwareControl",
      "OpticalDeviceType",
      "OpticalMediaType",
    ],
  ],
  [
    "filesystem",
    "Filesystem & layout",
    [
      "Content",
      "PartitionMapPartition",
      "FilesystemType",
      "FilesystemName",
      "FilesystemUserVisibleName",
      "FileSystemPersonality",
      "FileSystemName",
      "FileSystemType",
      "VolumeName",
      "VolumeKind",
      "VolumeType",
      "MediaUUID",
      "PartitionType",
      "MountPoint",
      "Mounted",
      "VolumeNetwork",
      "APFSVolumeGroupID",
      "APFSVolumeDisk",
      "APFSVolumeRole",
    ],
  ],
  [
    "access",
    "Access & capabilities",
    [
      "Writable",
      "WritableMedia",
      "WritableVolume",
      "ReadOnlyMedia",
      "ReadOnlyVolume",
      "GlobalPermissionsEnabled",
      "Owners",
      "SupportsGlobalPermissions",
      "SupportsGlobalPermissionsDisable",
      "SupportsGlobalPermissionsEnable",
      "SupportsJournal",
      "Journaled",
      "CanBeMadeBootable",
      "CanBeMadeBootableWithEFI",
      "Bootable",
      "BooterDeviceIdentifier",
      "RecoveryDeviceIdentifier",
      "Encrypted",
      "Encryption",
      "FileVault",
      "Locked",
      "AESHardware",
      "LowLevelFormatSupported",
      "CanBeMadeBootableRequiresDestroy",
    ],
  ],
  [
    "smart",
    "Source-reported SMART fields",
    ["SMARTDeviceSpecificKeysMayVaryNotGuaranteed"],
  ],
  [
    "system",
    "System & storage configuration",
    ["OS9DriversInstalled", "SystemImage", "RAIDMaster", "RAIDSlice"],
  ],
] as const;

export interface FieldGroup {
  id: string;
  label: string;
  fields: Field[];
}
export function groupFields(
  value: Json,
  mode: "device" | "branches" = "branches",
): FieldGroup[] {
  const fields = flatten(value);
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return [{ id: "$", label: "Reported fields", fields }];
  }
  if (!Object.keys(value).length)
    return [{ id: "$", label: "Reported fields", fields }];
  if (mode === "device") {
    const groups: FieldGroup[] = deviceGroups.map(([id, label]) => ({
      id,
      label,
      fields: [],
    }));
    const other: FieldGroup = {
      id: "other",
      label: "Other reported fields",
      fields: [],
    };
    for (const field of fields) {
      // Exact known source keys only. Unknown/vendor keys remain explicit.
      const root = /^[A-Za-z_$][\w$]*/.exec(field.path)?.[0];
      const index = deviceGroups.findIndex(
        ([, , keys]) => root && (keys as readonly string[]).includes(root),
      );
      (index < 0 ? other : groups[index]).fields.push(field);
    }
    return [...groups, other].filter((g) => g.fields.length);
  }
  const groups: FieldGroup[] = [];
  const scalar: FieldGroup = { id: "$", label: "Top-level fields", fields: [] };
  for (const [key, entry] of Object.entries(value)) {
    const path = /^[A-Za-z_$][\w$]*$/.test(key)
      ? key
      : `[${JSON.stringify(key)}]`;
    const rows = fields.filter(
      (f) =>
        f.path === path ||
        f.path.startsWith(`${path}.`) ||
        f.path.startsWith(`${path}[`),
    );
    if (entry !== null && typeof entry === "object" && rows.length > 1) {
      groups.push({ id: path, label: key, fields: rows });
    } else scalar.fields.push(...rows);
  }
  return [...(scalar.fields.length ? [scalar] : []), ...groups];
}

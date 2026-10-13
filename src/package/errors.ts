// Named rejection codes. Every rejection of a world package or checker bundle carries exactly
// one of these codes; callers (CLI, tests) match on the code, never on the message text.
export const PACKAGE_ERROR_CODES = [
  // archive container
  "E_ARCHIVE_TOO_LARGE",
  "E_ARCHIVE_INVALID",
  "E_ARCHIVE_LAYOUT",
  "E_TOO_MANY_ENTRIES",
  "E_UNSUPPORTED_ZIP_FEATURE",
  "E_HEADER_MISMATCH",
  "E_ENCRYPTED_ENTRY",
  "E_UNSUPPORTED_METHOD",
  // entry names and types
  "E_INVALID_PATH",
  "E_ABSOLUTE_PATH",
  "E_PATH_TRAVERSAL",
  "E_PATH_NOT_NFC",
  "E_SYMLINK_ENTRY",
  "E_SPECIAL_ENTRY",
  "E_DUPLICATE_ENTRY",
  // sizes and integrity
  "E_ENTRY_TOO_LARGE",
  "E_TOTAL_TOO_LARGE",
  "E_COMPRESSION_RATIO",
  "E_ENTRY_SIZE_MISMATCH",
  "E_CRC_MISMATCH",
  // manifest
  "E_MANIFEST_MISSING",
  "E_MANIFEST_INVALID",
  "E_FORMAT_MISMATCH",
  "E_SCHEMA_MAJOR_UNSUPPORTED",
  "E_UNLISTED_ENTRY",
  "E_MISSING_ENTRY",
  "E_SIZE_MISMATCH",
  "E_HASH_MISMATCH",
  // content
  "E_UNSUPPORTED_MEDIA_TYPE",
  "E_MEDIA_TYPE_MISMATCH",
  "E_EXECUTABLE_CONTENT",
  "E_JSON_INVALID",
  "E_JSON_TOO_DEEP",
  "E_ENTRY_INVALID",
  // packer source directory
  "E_SOURCE_INVALID",
] as const;

export type PackageErrorCode = (typeof PACKAGE_ERROR_CODES)[number];

export class PackageError extends Error {
  readonly code: PackageErrorCode;
  /** Archive-relative entry name the error refers to, if any. Never an absolute host path. */
  readonly entry: string | null;
  constructor(code: PackageErrorCode, message: string, entry: string | null = null) {
    super(`${code}: ${message}`);
    this.name = "PackageError";
    this.code = code;
    this.entry = entry;
  }
}

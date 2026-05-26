/**
 * Копия файла в память — не зависит от input[type=file] и диска.
 * Устраняет net::ERR_UPLOAD_FILE_CHANGED при отправке через fetch/FormData.
 */
export async function snapshotUploadFile(file) {
  if (!file || !(file instanceof Blob)) {
    return null;
  }

  const buffer = await file.arrayBuffer();
  const name = file.name || "import.xlsx";
  const type = file.type || "application/octet-stream";
  const lastModified =
    typeof file.lastModified === "number" ? file.lastModified : Date.now();

  return new File([buffer], name, { type, lastModified });
}

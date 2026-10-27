export function multipart(filename: string, buf: Buffer, contentType: string) {
  const b = "----testboundary";
  const head = Buffer.from(
    `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${b}--\r\n`);
  return { payload: Buffer.concat([head, buf, tail]), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
}

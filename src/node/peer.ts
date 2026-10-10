/**
 * Loads an optional peer dependency, or explains which one to install. The PDF and DOCX readers
 * are loaded only when a file of that format arrives, so a host installs only what it reads.
 */
export async function optional<T>(load: () => Promise<T>, packages: string): Promise<T> {
  try {
    return await load();
  } catch (error) {
    throw new Error(
      `Reading this format needs ${packages} installed beside the engine: npm install pdf-parse@2 pdfjs-dist@5.4.296 mammoth (with -g beside a global install; with npx, -p each of them).`,
      { cause: error },
    );
  }
}

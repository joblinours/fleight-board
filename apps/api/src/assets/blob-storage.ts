import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Stockage des fichiers importés. Implémentation sur disque (volume Docker) ;
 * un stockage objet (S3) pourra la remplacer sans toucher au reste.
 */
export type BlobStorage = {
  /** Enregistre un contenu sous sa clé (sans effet s'il existe déjà). */
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
  delete(key: string): Promise<void>;
};

/** Fichiers sous `root`, répartis par les deux premiers caractères de la clé. */
export class FilesystemBlobStorage implements BlobStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.#path(key);
    if (await exists(path)) return;
    await mkdir(join(this.#root, key.slice(0, 2)), { recursive: true });
    // Écriture puis renommage : un lecteur ne voit jamais un fichier à moitié écrit.
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, path);
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.#path(key));
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }

  #path(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Clé de stockage invalide');
    return join(this.#root, key.slice(0, 2), key);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

import { createHash } from 'node:crypto';
import { can } from '@fleight/permissions';
import type { Asset, BoardRole } from '@fleight/protocol';
import { createId } from '@fleight/shared';
import { eq } from 'drizzle-orm';
import type { Identity } from '../auth/auth-service';
import { BoardError } from '../boards/board-service';
import type { Db } from '../database';
import { assets, boards } from '../db/schema';
import type { BlobStorage } from './blob-storage';
import { readImageInfo } from './image-info';

/** Erreur d'import, traduite en réponse HTTP par les routes. */
export class AssetError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_IMAGE' | 'IMAGE_TOO_LARGE' | 'ASSET_NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}

/** Dimension maximale d'une image importée, en pixels. */
export const MAX_IMAGE_DIMENSION = 16_384;

export class AssetService {
  readonly #db: Db;
  readonly #storage: BlobStorage;

  /**
   * Rôle d'un utilisateur sur un board (branché par l'application) ; sans cette
   * fonction, tout utilisateur connecté peut importer.
   */
  roleOf: ((userId: string, boardId: string) => Promise<BoardRole | undefined>) | undefined;

  constructor(db: Db, storage: BlobStorage) {
    this.#db = db;
    this.#storage = storage;
  }

  /** Importe une image dans un board ; son type est lu dans le fichier lui-même. */
  async upload(identity: Identity, boardId: string, data: Buffer): Promise<Asset> {
    const [board] = await this.#db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.id, boardId));
    if (!board) throw new BoardError('BOARD_NOT_FOUND', 'Board introuvable');
    if (this.roleOf && !can(await this.roleOf(identity.userId, boardId), 'board.edit')) {
      throw new BoardError('FORBIDDEN', 'Votre rôle ne permet pas d’importer dans ce board');
    }

    const info = readImageInfo(data);
    if (!info || info.width < 1 || info.height < 1) {
      throw new AssetError('UNSUPPORTED_IMAGE', 'Image non reconnue (PNG, JPEG, GIF ou WebP)');
    }
    if (info.width > MAX_IMAGE_DIMENSION || info.height > MAX_IMAGE_DIMENSION) {
      throw new AssetError(
        'IMAGE_TOO_LARGE',
        `Image trop grande (${MAX_IMAGE_DIMENSION} pixels au plus de côté)`,
      );
    }
    const sha256 = createHash('sha256').update(data).digest('hex');
    await this.#storage.put(sha256, data);
    const asset: Asset = {
      id: createId(),
      mimeType: info.mimeType,
      size: data.length,
      width: info.width,
      height: info.height,
    };
    await this.#db
      .insert(assets)
      .values({ ...asset, boardId, sha256, uploadedBy: identity.userId });
    return asset;
  }

  /** Contenu d'un fichier importé, avec son type. */
  /** Contenu d'un fichier importé ; `boardId` : seulement s'il appartient à ce board (invités). */
  async read(id: string, boardId?: string): Promise<{ asset: Asset; data: Buffer }> {
    const [row] = await this.#db.select().from(assets).where(eq(assets.id, id)).limit(1);
    const allowed = row && (boardId === undefined || row.boardId === boardId);
    const data = allowed && (await this.#storage.get(row.sha256));
    if (!row || !data) throw new AssetError('ASSET_NOT_FOUND', 'Fichier introuvable');
    return {
      asset: {
        id: row.id,
        mimeType: row.mimeType,
        size: row.size,
        width: row.width,
        height: row.height,
      },
      data,
    };
  }
}

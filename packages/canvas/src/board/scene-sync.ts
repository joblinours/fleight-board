import type { BoardDocument, DocumentChange } from '@fleight/document';
import type { Scene } from '../scene';
import { type BoardSceneItem, toSceneItem } from './scene-items';

/**
 * Maintient une scène à jour à partir du document.
 * Les connecteurs accrochés à un objet modifié sont recalculés avec lui.
 */
export function syncScene(document: BoardDocument, scene: Scene<BoardSceneItem>): () => void {
  const items = (): BoardSceneItem[] => {
    const result: BoardSceneItem[] = [];
    for (const object of document.all()) {
      const item = toSceneItem(document, object);
      if (item) result.push(item);
    }
    return result;
  };
  scene.load(items());

  const refresh = (id: string) => {
    const object = document.get(id);
    const item = object && toSceneItem(document, object);
    if (item) scene.upsert(item);
    else scene.remove(id);
  };

  return document.subscribe((change: DocumentChange) => {
    const touched = new Set<string>([...change.created, ...change.updated]);
    for (const object of change.deleted) {
      scene.remove(object.id);
      // Un connecteur dont l'objet a disparu n'a plus de tracé.
      for (const id of document.connectorsOf(object.id)) touched.add(id);
    }
    for (const id of [...touched]) {
      for (const connectorId of document.connectorsOf(id)) touched.add(connectorId);
    }
    for (const id of touched) refresh(id);
  });
}

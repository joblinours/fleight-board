# Contribuer à Fleight Board

Merci de l'intérêt que vous portez à Fleight Board ! Ce guide explique comment proposer une contribution.

## Avant de commencer

- **CLA obligatoire.** Toute contribution nécessite l'acceptation du [Contributor License Agreement](CLA.md). Fleight Board est distribué sous double licence ([C8CL](LICENSE.md) et [licence commerciale](COMMERCIAL-LICENSE.md)) ; le CLA permet à Couche 8 de distribuer votre code sous ces deux licences. Vous conservez vos droits d'auteur.
- **Ouvrez d'abord une issue** pour toute modification importante (nouvelle fonctionnalité, changement d'architecture ou de protocole), afin d'en discuter avant d'écrire le code.
- **Vulnérabilités** : ne les signalez pas dans une issue publique. Contactez Couche 8 via [couche-8.com](https://couche-8.com).

## Workflow git

```text
main      ← versions stables uniquement (releases)
  ↑
dev       ← branche d'intégration
  ↑
feature/* ← une branche par fonctionnalité ou correctif
```

1. Créez votre branche depuis `dev` : `feature/<sujet>` ou `fix/<sujet>`.
2. Ouvrez une pull request **vers `dev`**, jamais vers `main`.
3. Sur votre première PR, postez le commentaire d'acceptation du CLA (voir [CLA.md](CLA.md#8-how-to-accept)).
4. La CI doit être verte et la PR relue avant fusion.

## Lancer le projet

`./scripts/dev.sh` démarre l'environnement complet (voir le [README](README.md#développement)).

## Messages de commit

Le projet suit [Conventional Commits](https://www.conventionalcommits.org/) :

```text
feat(canvas): add pressure-sensitive pen tool
fix(collaboration): release lock on socket disconnect
docs(readme): document backup procedure
```

Types : `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

## Qualité du code

_(les commandes seront précisées à la création du monorepo)_

Avant d'ouvrir une PR :

- le lint, le formatage et le typecheck passent ;
- les tests existants passent et les nouveaux comportements sont testés ;
- toute modification du protocole WebSocket incrémente sa version et est documentée ;
- toute nouvelle permission ou opération est validée côté serveur.

## Dépendances

Seules les dépendances sous licence **permissive** (MIT, Apache-2.0, BSD, ISC) sont acceptées, pour rester compatibles avec la double licence. Les dépendances GPL, AGPL, ou nécessitant une licence commerciale (par exemple le SDK tldraw) sont refusées.

## Documentation

Le [README](README.md) décrit l'état réel du projet. Si votre contribution modifie une fonctionnalité, une commande ou une configuration, mettez-le à jour dans la même PR.

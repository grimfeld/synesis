# Aperçu en direct et mode source

Les documents s'ouvrent en aperçu en direct : la syntaxe markdown est masquée et rendue, sauf sur la ligne que vous modifiez. Le mode source montre le markdown brut, tel qu'il est enregistré, pour voir ou taper la syntaxe elle-même. Le texte est le même dans les deux cas.

1. Ouvrez une de vos Notes avec [Rechercher](command:nav.search). Titres, gras et cases à cocher s'affichent sans leurs `#`, `**` et `- [ ]`. Cliquez dans un titre : son `#` apparaît, sur cette ligne seulement.
2. Lancez [Mode source](command:editor.source). Chaque ligne montre le markdown tel qu'il est dans le fichier, `[[liens]]` compris. Le fichier n'a pas changé, seulement son affichage. Le bouton de code de l'en-tête reste en surbrillance tant que le mode source est actif.
3. Essayez une fois : créez une Note avec [Nouvelle Note](command:create.note) (son bouton **Supprimer** dans l'en-tête l'enlève ensuite). Tapez `## Un titre`, puis à la ligne `**quelques mots en gras**`. Lancez [Aperçu en direct](command:editor.source) : le `##` disparaît, et les `**` aussi dès que le curseur quitte la ligne.

## À savoir

- Le mode est un seul réglage pour tous les documents ; il reste tel que vous l'avez laissé.
- Passages, liens et tags restent mis en évidence dans les deux modes.

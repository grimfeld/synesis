# Propriétés et dates

Les propriétés sont les valeurs nommées qu'un document porte en plus de son texte : la latitude d'un Lieu, la Source d'une Note, la naissance d'un Personnage. Les dates s'y écrivent comme on les dit, et la bonne paire place une page sur la chronologie.

1. Ouvrez un de vos Lieux ou Personnages, ou créez-en un avec [Nouveau Lieu](command:create.place). Ses propriétés sont dans la carte en haut de sa page (pour une Note, sous **Propriétés** dans le panneau latéral), chacune avec un champ adapté à son type : nombre, lien, date.
2. Tapez un nom dans **Ajouter une propriété** et appuyez sur Entrée. À la première utilisation d'un nom, vous choisissez son type, et tout le coffre le retient : tapez ce nom sur une autre page, son type est déjà connu. Cliquez sur l'étiquette d'une propriété pour changer son type ou **Supprimer la propriété**.
3. Écrivez les dates comme un lecteur les dit : `v. 1513 av. n. è.`, `14 nisan 33 de n. è.`, `52 de n. è.`. L'application lit l'année, sa précision et si elle est approximative, sans jamais réécrire ce que vous avez tapé. Une date illisible est signalée en rouge sous **Dates** sur sa page, et reste hors de la chronologie.
4. Essayez une fois : créez un Personnage avec [Nouveau Personnage](command:create.character) et remplissez **Naissance** et **Mort**. Lancez [Aller à Chronologie](command:nav.timeline) : les deux dates forment une période, tracée comme une barre sur la piste du Personnage. **Début** et **Fin** font de même pour un Événement. Supprimez le Personnage depuis l'en-tête de sa page si ce n'était qu'un essai.

## À savoir

- Choisissez **Date (Bible)** pour la chronologie biblique et **Date du calendrier** pour le monde d'aujourd'hui.
- Une période ne se déclare jamais : toute page qui a `born` et `died`, ou `start` et `end`, en a une. Toute autre date est une simple marque sur sa piste.
- Dans le fichier, les noms de propriétés restent en anglais (`born`, `died`) quelle que soit la langue de l'application, pour que le coffre se lise pareil dans Obsidian.

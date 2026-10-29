# Propriétés et dates

Les propriétés sont les valeurs nommées qu'un document porte en plus de son texte : la latitude d'un Lieu, la Source d'une Note, la naissance d'un Personnage. Les dates s'y écrivent comme on les dit, et la bonne paire place une page sur la chronologie.

1. Ouvrez un de vos Lieux ou Personnages, ou créez-en un avec [Nouveau Lieu](command:create.place). Ses propriétés sont sous **Propriétés**, vers le bas de sa page, juste au-dessus d'**À propos** (pour une Note, sous **Propriétés** dans le panneau latéral), chacune avec un champ adapté à son type : nombre, lien, date.
2. Tapez un nom dans **Ajouter une propriété** et appuyez sur Entrée. À la première utilisation d'un nom, vous choisissez son type, et tout le coffre le retient : tapez ce nom sur une autre page, son type est déjà connu. Cliquez sur l'étiquette d'une propriété pour changer son type ou **Supprimer la propriété**.
3. Écrivez les dates comme un lecteur les dit : `v. 1513 av. n. è.`, `14 nisan 33 de n. è.`, `52 de n. è.`. L'application lit l'année, sa précision et si elle est approximative, sans jamais réécrire ce que vous avez tapé. Une date illisible est signalée en rouge sous **Dates** sur sa page, et reste hors de la chronologie.
4. Sous **Dates**, **Ajouter une Date** propose ce que la page peut encore recevoir : **Ajouter naissance et mort** sur un Personnage ajoute **Naissance** et **Mort**, **Ajouter début et fin** sur un Événement, un Voyage ou un Lieu ajoute **Début** et **Fin**, et **Date…** ajoute une date que vous nommez vous-même. Quand une moitié de la paire existe déjà, seule l'autre est proposée. Le nouveau champ est prêt à la saisie ; il s'écrit dans le fichier dès qu'il a une valeur.
5. Essayez une fois : créez un Personnage avec [Nouveau Personnage](command:create.character), choisissez **Ajouter une Date**, puis **Ajouter naissance et mort**, et remplissez **Naissance** et **Mort**. Lancez [Aller à Chronologie](command:nav.timeline) : les deux dates forment une période, tracée comme une barre sur la piste du Personnage. Supprimez le Personnage depuis l'en-tête de sa page si ce n'était qu'un essai.

## À savoir

- Choisissez **Date (Bible)** pour la chronologie biblique et **Date du calendrier** pour le monde d'aujourd'hui.
- Une période ne se déclare jamais : toute page qui a `born` et `died`, ou `start` et `end`, en a une. Toute autre date est une simple marque sur sa piste.
- Un Lieu qui a un **Début** sans **Fin** est tracé jusqu'au bord de la chronologie : une ville toujours debout.
- Un nom que le coffre emploie déjà avec un autre type ne peut pas devenir une date : un nom a le même type partout.
- Dans le fichier, les noms de propriétés restent en anglais (`born`, `died`) quelle que soit la langue de l'application, pour que le coffre se lise pareil dans Obsidian.

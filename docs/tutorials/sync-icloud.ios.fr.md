# iCloud Drive sur iPhone et iPad

La seule synchro de dossier gratuite qui atteint un iPhone ou un iPad. Fonctionne avec un Mac, un autre iPhone ou iPad, ou Windows via iCloud pour Windows. Synesis range ses coffres dans son propre dossier iCloud Drive, **Synesis**, que tous vos appareils Apple voient.

1. **Réglages → [votre nom] → iCloud → iCloud Drive** : activez **Synchroniser cet iPhone**. Toujours dans les réglages iCloud, touchez **Tout afficher** et vérifiez que **Synesis** peut utiliser iCloud.
2. Lancez Synesis et choisissez **Utiliser un dossier synchronisé**. Cochez les autres appareils que vous utilisez : iCloud Drive est recommandé. Si l'assistant indique qu'iCloud n'est pas disponible, Synesis ne peut pas encore atteindre iCloud : vérifiez l'étape 1, puis revenez.
3. Un coffre déjà présent dans iCloud Drive → Synesis (créé sur votre Mac ou un autre iPhone) apparaît sous *Synchronisé depuis …* ; touchez-le. Sinon nommez le coffre et choisissez **Créer le coffre** : Synesis le crée dans iCloud Drive → Synesis, où l'app Fichiers le montre.
4. Essayez une fois : sur cet appareil, créez une note avec [Capture rapide](command:create.quick) contenant une ligne comme *test de synchro depuis cet appareil*. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé, puis ouvrez Synesis sur l'autre appareil (ou relancez-le) : la note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents. Supprimez ensuite la note de test avec le bouton de suppression de son en-tête.

## À savoir

- iOS garde les fichiers dans iCloud et les télécharge au besoin, et peut décharger ceux que vous n'avez pas ouverts depuis un moment. Synesis garde un tel document dans la liste, le demande à iCloud et l'ouvre dès qu'il est arrivé ; d'ici là il ne peut pas être modifié, pour que rien n'écrase la copie d'iCloud. La première fois que vous ouvrez un gros coffre, laissez-lui une minute en Wi-Fi.
- Le mode Économie d'énergie suspend la synchro iCloud. Branchez l'appareil ou désactivez-le après une longue séance d'écriture.
- Un coffre créé sur cet iPhone avec *Seulement cet appareil*, ou avec Synesis 0.0.19 ou antérieur, se trouve dans Fichiers → Sur mon iPhone → Synesis et ne se synchronise pas par iCloud. Associez-le plutôt à votre autre appareil, ou créez un coffre dans iCloud et copiez-y ses notes avec l'app Fichiers.
- Modifier la même note sur iPhone et Mac en même temps ne pose pas de problème quand les deux sont en ligne ; les modifications hors ligne fusionnent à la reconnexion. Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. S'il crée quand même un fichier « copie en conflit », supprimez cette copie : le texte fusionné est déjà dans le fichier d'origine.
- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.

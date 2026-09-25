# OneDrive, Google Drive ou Dropbox sur Windows

OneDrive, Google Drive et Dropbox offrent tous un niveau gratuit (5 Go, 15 Go et 2 Go) et une application de bureau qui reflète un dossier sur chaque ordinateur connecté. Placez le coffre dans ce dossier. Leurs apps mobiles ne reflètent **pas** les dossiers ; cela couvre donc les ordinateurs seulement ; ajoutez Syncthing plus tard si un téléphone s'ajoute.

## OneDrive (intégré à Windows)

1. Cliquez sur l'icône de nuage dans la barre des tâches, connectez un compte Microsoft. Votre dossier est `C:\Users\<vous>\OneDrive`.
2. Clic droit sur le dossier OneDrive → **Toujours conserver sur cet appareil**, ou dans **Paramètres OneDrive → Synchronisation et sauvegarde → Avancé**, désactivez *Fichiers à la demande*.
3. Créez le coffre dans `C:\Users\<vous>\OneDrive\Synesis` (Synesis le propose).

## Google Drive pour ordinateur

1. Installez depuis [google.com/drive/download](https://www.google.com/drive/download/), connectez-vous.
2. Dans **Préférences → Google Drive**, choisissez **Dupliquer les fichiers** (pas *Diffuser*). Le dossier est `C:\Users\<vous>\Mon Drive` ou `G:\Mon Drive`.
3. Créez le coffre dans `…\Mon Drive\Synesis`.

## Dropbox

1. Installez depuis [dropbox.com/install](https://www.dropbox.com/install), connectez-vous. Dossier : `C:\Users\<vous>\Dropbox`.
2. Dans **Préférences → Synchronisation**, réglez les nouveaux fichiers sur *Local* (pas *En ligne uniquement*).
3. Créez le coffre dans `C:\Users\<vous>\Dropbox\Synesis`.

## Règles pour un coffre fiable

- **Désactivez** « fichiers à la demande » / « en ligne seulement » pour le dossier du coffre, ou marquez le dossier Synesis *Toujours conserver sur cet appareil*. Synesis lit les fichiers directement ; un espace réservé non téléchargé paraît vide.
- N'ouvrez pas le coffre depuis deux ordinateurs avec l'app de bureau **en pause** sur l'un pendant des jours ; la fusion s'en sort, mais plus l'écart est long, plus `.bible-study/sync/` a à rapprocher d'un coup.
- Des fichiers « copie en conflit » peuvent apparaître si deux ordinateurs enregistrent dans la même seconde. Supprimez la copie ; le texte fusionné de Synesis est dans l'original.


## Vérifier que ça marche

1. Sur cet appareil, créez une note (Capture rapide, `Ctrl/⌘ ⇧ N`) avec une ligne comme *test de synchro depuis cet appareil*.
2. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé.
3. Sur l'autre appareil, ouvrez Synesis (ou relancez-le). La note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents.
4. Modifiez la même note sur les deux appareils pendant que l'un est hors ligne, puis reconnectez. Les deux modifications survivent : Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. S'il crée quand même un fichier « copie en conflit », supprimez cette copie : le texte fusionné est déjà dans le fichier d'origine.

## Bon à savoir

- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Une seule instance de Synesis (ou d'Obsidian) à la fois doit éditer un fichier ; la fusion gère les modifications hors ligne, pas deux curseurs sur la même ligne à la même seconde.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.

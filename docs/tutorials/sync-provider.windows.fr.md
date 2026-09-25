# OneDrive, Google Drive ou Dropbox sur Windows

OneDrive, Google Drive et Dropbox offrent tous un niveau gratuit (5 Go, 15 Go et 2 Go) et une application de bureau qui reflète un dossier sur chaque ordinateur connecté. Placez le coffre dans ce dossier. Leurs apps mobiles ne reflètent **pas** les dossiers ; cela couvre donc les ordinateurs seulement ; ajoutez Syncthing plus tard si un téléphone s'ajoute.

1. Installez le client de votre fournisseur, réglez-le pour garder les fichiers sur cet ordinateur, et créez le coffre dans son dossier :
   - **OneDrive** (intégré à Windows)
     - Cliquez sur l'icône de nuage dans la barre des tâches, connectez un compte Microsoft. Votre dossier est `C:\Users\<vous>\OneDrive`.
     - Clic droit sur le dossier OneDrive → **Toujours conserver sur cet appareil**, ou dans **Paramètres OneDrive → Synchronisation et sauvegarde → Avancé**, désactivez *Fichiers à la demande*.
     - Créez le coffre dans `C:\Users\<vous>\OneDrive\Synesis` (Synesis le propose).
   - **Google Drive pour ordinateur**
     - Installez depuis [google.com/drive/download](https://www.google.com/drive/download/), connectez-vous.
     - Dans **Préférences → Google Drive**, choisissez **Dupliquer les fichiers** (pas *Diffuser*). Le dossier est `C:\Users\<vous>\Mon Drive` ou `G:\Mon Drive`.
     - Créez le coffre dans `…\Mon Drive\Synesis`.
   - **Dropbox**
     - Installez depuis [dropbox.com/install](https://www.dropbox.com/install), connectez-vous. Dossier : `C:\Users\<vous>\Dropbox`.
     - Dans **Préférences → Synchronisation**, réglez les nouveaux fichiers sur *Local* (pas *En ligne uniquement*).
     - Créez le coffre dans `C:\Users\<vous>\Dropbox\Synesis`.
2. Gardez le coffre sur cet ordinateur : **désactivez** « fichiers à la demande » / « en ligne seulement » pour le dossier du coffre, ou marquez le dossier Synesis *Toujours conserver sur cet appareil*. Synesis lit les fichiers directement ; un espace réservé non téléchargé paraît vide.
3. Essayez une fois : sur cet ordinateur, créez une note avec [Capture rapide](command:create.quick) contenant une ligne comme *test de synchro depuis cet appareil*. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé, puis ouvrez Synesis sur l'autre ordinateur (ou relancez-le) : la note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents. Supprimez ensuite la note de test avec le bouton de suppression de son en-tête.

## À savoir

- N'ouvrez pas le coffre depuis deux ordinateurs avec l'app de bureau **en pause** sur l'un pendant des jours ; la fusion s'en sort, mais plus l'écart est long, plus `.bible-study/sync/` a à rapprocher d'un coup.
- Modifiez la même note sur les deux ordinateurs pendant que l'un est hors ligne, puis reconnectez : les deux modifications survivent. Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. Des fichiers « copie en conflit » peuvent quand même apparaître si deux ordinateurs enregistrent dans la même seconde. Supprimez la copie ; le texte fusionné de Synesis est dans l'original.
- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Une seule instance de Synesis (ou d'Obsidian) à la fois doit éditer un fichier ; la fusion gère les modifications hors ligne, pas deux curseurs sur la même ligne à la même seconde.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.

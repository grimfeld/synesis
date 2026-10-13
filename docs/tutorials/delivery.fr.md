# La vue de présentation

La vue de présentation est l'endroit d'où vous donnez un discours : la composition occupe tout l'écran, avec son texte, son tableau ou les deux, et un minuteur. Rien n'y est modifiable et rien n'en fait sortir : un geste au milieu du discours ne vous fait jamais perdre le fil. L'écran reste allumé tant qu'elle est ouverte.

Ce tutoriel est masqué pendant que la vue est ouverte : lisez une étape, faites-la, puis appuyez sur **Quitter** pour revenir ici.

1. Ouvrez la composition que vous préparez avec [Rechercher](command:nav.search), puis lancez [Présenter cette Composition](command:doc.deliver) ; le bouton **Présenter** de son en-tête fait de même. Le discours remplit l'écran depuis son début, chaque ligne affichée sans son markdown. Appuyez sur **Quitter**, ou Échap, pour retrouver la page telle que vous l'aviez laissée.
2. Présentez de nouveau et touchez un passage ou un lien : il s'ouvre dans une carte par-dessus le discours, sans jamais le quitter. Échap ou un toucher ailleurs ferme la carte. **Afficher**, dans la barre, passe de **Discours** à **Côte à côte** et à **Tableau**, et **Texte plus grand** et **Texte plus petit** règlent la taille du discours (pincez sur un écran tactile). Puis quittez.
3. Présentez de nouveau et appuyez sur **Démarrer**. Le minuteur décompte depuis la propriété `duration` de la composition, passe à l'orange pour les deux dernières minutes et au rouge à zéro, puis compte le dépassement, `+1:30`. **Pause** l'arrête et **Réinitialiser** le remet au départ. Quittez et présentez de nouveau : le minuteur a continué.
4. Essayez une fois : répétez l'ouverture de votre discours. Présentez-le, appuyez sur **Démarrer**, lisez à voix haute votre première partie, puis quittez. Rien ne change dans votre coffre.

## À savoir

- Le minuteur décompte depuis une propriété `duration`, un nombre de minutes, posée sur la composition pendant la préparation. Sans elle, il compte à partir de 0:00.
- La vue s'ouvre sur l'affichage qui était à l'écran : Discours, Côte à côte ou Tableau.
- La taille du texte est gardée sur cet appareil ; le tableau garde son propre zoom.
- Les raccourcis de l'application et la palette de commandes sont coupés tant que la vue est ouverte : rien ne s'exécute derrière elle.
- Là où l'écran ne peut pas rester allumé, la barre l'indique : « L’écran peut se mettre en veille ».

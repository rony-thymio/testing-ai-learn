# Thymio · Neurones

> **AI Lab (this fork):** a second mode, AlphAI-style learning (supervised and reinforcement), is being added. See
> [AI-LAB.md](AI-LAB.md) (in English).

Une page web pour **regarder et régler l'apprentissage du Thymio 3**: le mode « réseau de neurones » du
firmware (le mode blanc, `main/ann.c`), où le robot apprend à éviter les obstacles en se cognant. La page
montre le réseau qui apprend, ses 16 poids qui bougent, l'activité des capteurs, des connexions et des
roues, et laisse changer à la main les poids (dont la vitesse du robot), la vitesse d'apprentissage et l'oubli.

Pensée pour des élèves d'environ 12 ans: du texte, de vrais nombres, un style sobre (sombre ou clair),
alors que [thymio3-cards](../thymio3-cards) vise les plus petits avec des pictogrammes. Même base technique
(React + Vite + `thymio3-ts-api`), mêmes principes pour parler au robot.

**Essayé sans robot seulement** (robot virtuel, faux robot Bluetooth, tests). Pas encore sur un vrai Thymio 3: voir « Statut ».

## Le mode du firmware, tel qu'il est reproduit

Un réseau sans couche cachée: les **7 capteurs de proximité** (5 devant, 2 derrière) et une entrée constante
(le « biais ») sont reliés aux **2 roues**, soit 16 poids.

```
x[i] = lecture[i] / 20         x[7] = 1 (le biais)
roue = (x[0]·w[0] + … + x[6]·w[6] + x[7]·w[7]) / 30
```

Le poids du biais (2000) est la vitesse du robot quand rien n'est devant lui: 2000 / 30 = 66. Il y en a **deux**, un par roue (le firmware en a
autant: 16 poids en tout), et ils peuvent différer: un robot dont les deux roues n'ont pas la même base tourne en rond. Dans l'interface
on les voit comme ce qu'ils sont, **l'entrée « 1 »** et ses deux poids, exprimés directement en vitesse. Le firmware donne 66,7; **l'interface
démarre le robot à 67** (un nombre entier, la valeur par défaut), un écart de 0,3 avec le firmware; le mode, lui, garde 2000 / 30 quand on
ne lui dit rien (c'est ce que vérifient les tests).

- **Avance** (blanc qui pulse): le réseau conduit. Si un capteur avant dépasse **3300**, c'est un choc.
- **Recule** (rouge): 1 s à −200, en mémorisant quels capteurs ont touché.
- **Apprend** (vert, 0,3 s): capteurs de gauche (0, 1) → roue gauche **+pas**, roue droite **−pas**; capteurs de droite (3, 4) →
  l'inverse; capteur du milieu (2) → la roue du côté le moins touché perd un demi-pas. Le pas est 3.
- **Oubli**: toutes les 16 s chaque poids (sauf le biais) se rapproche de 0.
- Boutons du robot: flèche arrière = pause, avant = reprendre, gauche ou droite = geler / reprendre l'apprentissage, centre = quitter.
- Les 16 LED Lego montrent le nombre de leçons, le cercle de LED le niveau des poids.

Les poids du firmware sont des variables C que rien ne permet de lire ni de changer. `src/py/ann_mode.py` est
donc le **même mode réécrit en MicroPython**, qui tourne sur le robot, conduit les moteurs lui-même et
**dit ses poids**. Il s'installe à la place du mode d'origine tant qu'il tourne.

Écarts avec le firmware (voulus):

| Firmware | Ici |
| --- | --- |
| pas 3, vitesse 67 et oubli 16 s fixes | réglables depuis la page (mêmes valeurs au départ) |
| un poids de 0,5 oscille entre +0,5 et −0,5 à chaque oubli (le pas d'oubli est 1) | un poids s'arrête à 0 |
| pas de limite des poids | ±100 (au-delà, un capteur seul dépasse la vitesse maximale) |
| vitesse non limitée | ±500 |
| moteurs donnés toutes les 100 ms | à chaque tick de 20 ms (voir « Moteurs ») |
| rien n'est dit | une ligne `@@n` toutes les 100 ms, `@@w` à chaque changement de poids |

## Ce que montre la page

- **Le robot et son réseau, dans une seule image**: le robot vu de dessus, dessiné d'après les photos du Thymio 3 (nez arrondi,
  côtés droits, une échancrure de chaque côté où se loge la roue, un talon plat), et **le réseau de neurones dedans**. Sur un écran
  large le robot regarde vers la gauche (les roues sont en haut et en bas); sur un écran étroit il regarde vers le haut.
  - **Les 7 capteurs** sont sur son nez, numérotés, remplis par ce qu'ils lisent, chacun avec son **cône**: sa longueur est la distance
    que la lecture représente (`distanceFromProx` dans `src/spec.js`), donc **lecture basse = objet loin = grand cône** (pâle quand il
    ne voit rien), lecture haute = objet près = petit cône marqué; le nombre au bout est la lecture (0 à 4095). Un anneau rouge = choc.
  - **L'entrée « 1 »** (« Toujours 1 ») est sur le talon, avec ses deux connexions: **le poids de chacune est la vitesse de cette roue
    quand rien n'est devant le robot** (67, la vitesse du robot du fabricant). Il n'y a plus de curseur « vitesse du robot » dans la barre:
    on touche le 67 sur le robot, on tape un autre nombre (0 à 200, au dixième) ou on remet la valeur par défaut. Les deux se
    règlent séparément. **Les deux neurones « + »** sont dans le corps, chacun à côté de sa roue.
    Un neurone additionne ce qu'apporte chaque capteur et ce qu'apporte l'entrée « 1 », et envoie le résultat à **sa roue**: un pneu dont les
    rainures avancent ou reculent à une vitesse **exactement proportionnelle** à celle de la roue, avec le nombre à côté.
  - **16 connexions** relient les capteurs et l'entrée « 1 » aux neurones, d'autant plus épaisses que leur poids est grand; **bleu** = elle
    accélère la roue, **rouge** = elle freine, les deux finissent par une flèche qui s'arrête un peu avant le neurone; ce qui coule dessus
    est la vitesse que ce capteur ajoute à cette roue à cet instant. Un poids qui change clignote.
    **Le nombre sur un trait est le poids: on le touche et on tape un autre nombre** (Entrée ou un clic ailleurs valide, Échap annule,
    les flèches haut/bas ou − / + font un demi-cran, un cran entier pour la vitesse de base). Il n'y a pas de curseur pour les poids.
  - **Le robot et le réseau ne se confondent pas**: le robot (silhouette, plots Lego, boutons) est dessiné en **gris-bleu pâle**, comme un
    fond; le réseau est au premier plan: neurones blancs cerclés de noir, traits bleus ou rouges, nombres sur fond blanc, capteurs en
    couleur. Les nombres des connexions sont au-dessus de tous les traits, pour qu'on puisse toujours les toucher. Les cinq capteurs
    de devant sont **à égale distance** les uns des autres (27,5 mm, `src/spec.js`).
  - **Le talon est rangé**: l'entrée « 1 » est tout au fond; le capteur 6 ou 7 qui est juste derrière un neurone arrive **tout droit, vers
    son milieu**; l'autre capteur du talon (dont le trait traverse le robot) arrive **du côté du milieu, plus vers l'avant**, hors du
    fouillis; l'entrée « 1 » arrive entre les deux. Les nombres de ces traits sont placés pour ne pas se recouvrir. Les traits à
    poids nul sont en gris foncé (pas en gris pâle comme le dessin du robot). Le trou du stylo, au milieu, est sur la ligne de l'axe des
    roues, comme les deux neurones.
  - **Un « ? » sur chaque neurone** ouvre une fenêtre avec **le calcul du neurone en direct**: pour chaque entrée, `lecture × poids ÷ 600`
    (600 = 20 × 30, « un nombre de normalisation » qui remet les lectures à l'échelle des vitesses) et la vitesse qu'elle apporte, puis la somme et la vitesse de la roue (partie entière, entre −500 et 500). Sa hauteur ne change jamais (la place de
    la note est gardée). Elle se déplace en tirant son titre (sur un écran étroit elle est en bas) et se ferme avec × ou Échap. Quand le robot recule, apprend ou est en pause, la roue
    ne suit pas le réseau: la fenêtre le dit et donne la vitesse réelle. Le calcul est celui de `NeuronHelp.jsx` sur les mêmes lignes que
    le dessin, donc ce qu'on y additionne est ce qu'on voit.
- **La barre du haut** (deux lignes, toujours visible sur un grand écran; il n'y a plus de colonne à droite): la première a l'icône de
  l'application (elle ouvre les paramètres), le titre, robot virtuel ou réel et le bouton pour connecter un Thymio (avec un robot
  réel: son nom, qui porte le numéro de série, et sa batterie, à côté du bouton);
  la seconde a **les commandes**: l'interrupteur « Apprentissage » (le robot apprend ou non), tout oublier, un menu de quatre cerveaux
  tout faits (vierge, évite, attiré, prudent), pause, et les deux curseurs (vitesse d'apprentissage, oubli: jamais
  ou toutes les n s). Rien n'est enregistré. Rien ne bouge dans la barre quand l'état du robot change: la confirmation « reçu par le
  robot » est une petite coche dans la marge de droite (le texte est son infobulle). Sur un écran étroit les commandes sont l'onglet
  « Réglages » / « Controls ».
- **Au-dessus de l'image**, à droite du titre: le cycle du robot (avance → choc, recule → apprend, avec une marque sur l'étape en
  cours) et les leçons retenues (les 16 LED Lego du robot). La phrase qui explique l'étape est l'infobulle du cycle, celle des chocs et
  des leçons faites celle des leçons. **Sous l'image**: la légende et, dépliable, la règle d'apprentissage telle que le mode l'applique
  (le choc: un des 5 capteurs de devant dépasse 3300 → il recule 1 s; la leçon: un pas sur les poids des capteurs qui ont touché,
  tableau capteur par capteur, la moitié d'un pas pour le capteur de devant; l'oubli: chaque poids se rapproche de 0 de 1; ce qui ne
  change jamais; gelé = chocs ignorés). Le pas et le délai d'oubli affichés sont ceux des curseurs. Il n'y a plus de barre
  sous l'image. **L'interrupteur « Apprentissage » ne dépend pas de la pause**: un robot gelé reste gelé pendant la pause (et après),
  et on peut l'activer ou le geler pendant la pause.
- **Les signaux au fil du temps** (la carte se replie sur son titre; **fermée au départ**, le choix est gardé): une pile de graphiques qui ont **le même axe du temps et les mêmes marges**, donc alignés de haut
  en bas (ce qui se passe au même instant est sur la même verticale): les lectures des capteurs (avec le seuil de choc), les poids
  vers la roue gauche, les poids vers la roue droite, la vitesse des roues. Chaque graphique se cache avec son œil, et on choisit les
  signaux à comparer (capteurs 1 à 7, roue gauche, roue droite; « Tous » / « Aucun »). Une marque rouge sur tous les graphiques est un
  choc; un seul curseur traverse la pile. Durée: 30 s, 1, 5 ou 15 min (le robot garde 15 min de lectures); vue tableau des poids.
- **Robot virtuel** ou **robot réel** (bouton en haut): le virtuel a une arène où l'on **glisse les obstacles**, avec un temps
  accéléré (×1 à ×10); la carte de l'arène se replie sur son titre, **fermée au départ** (le robot virtuel continue de rouler). Avec un robot réel il n'y a
  pas d'arène et pas de panneau à part: le robot est celui de l'image.
- **Paramètres** (cliquer **l'icône de l'application**, en haut à gauche, ou la touche D): **la langue** (italien, français, allemand,
  anglais; la langue du navigateur est prise si c'est l'une des quatre), **le thème** (auto, clair, sombre), et tout l'ancien diagnostic:
  la liaison avec le robot, le journal de la liaison, le test de la liaison, le programme du robot, les raccourcis.
  (Les commandes s'appellent « Réglages » en français, « Controls » en anglais, pour ne pas les confondre avec les paramètres.)

Clavier: Espace = pause, G = geler, 0 = tout oublier, D = paramètres.

### Passer la configuration aux élèves (code QR)

Deux boutons en haut à droite, à côté de l'aide (trois boutons carrés de même taille, bordés comme les autres boutons de la barre; la barre du haut a une seule hauteur de contrôle, 34 px, un seul rayon et une seule bordure), comme dans l'application à cartes (`thymio3-cards`): **le bouton blanc** affiche en grand le code
QR de la configuration actuelle, **le bouton bleu** scanne le code d'un autre appareil (caméra derrière un viseur, ou une photo du code si la caméra
est refusée ou absente) et applique tout d'un coup. Le bouton bleu est grisé tant que le mode ne tourne pas (robot en cours de connexion).

- **Ce que contient le code** (`src/share.js`, texte `T3L1;l=fr;n=0;s=30;b=670,670;f=16;w=90,60,0,…`, une centaine de caractères, un code de 37 modules,
  facile à scanner à travers une salle): la langue, **l'affichage ou non du pseudo** (le réglage « Afficher le pseudo », champ `n`; le pseudo lui-même reste sur son appareil), la vitesse
  d'apprentissage, les deux vitesses de base (celles de l'entrée « 1 »), le délai d'oubli et **les 14 poids**. Les nombres sont ceux du protocole avec le robot (dixièmes). Un enseignant règle un cerveau, l'affiche, les élèves le
  scannent; un élève peut aussi montrer le cerveau que son robot a appris, et l'enseignant le photographie.
- **Lecture stricte**: ce qui vient d'un scan est une donnée, jamais exécutée. Un champ invalide est ignoré, un champ absent laisse cette partie de la
  page telle quelle, un code d'une autre application (celui des cartes est `T3C1`) est refusé avec un message. Le thème, le pseudo lui-même, l'état gelé ou en pause
  et l'arène ne voyagent pas.
- **Le pseudo sous le code** (`src/names.js`): avec la date et l'heure, écrit en grand sous le code pour reconnaître sur une photo l'appareil dont il vient.
  Chaque appareil en tire un au hasard au premier lancement, **dans le style des pseudos de jeux en ligne** pour des 12 à 14 ans: un mot de science ou de
  vitesse et une créature, collés, puis deux chiffres (`NeonFalcon42`, `QuantumLynx07`; 46 × 38 × 90 = environ 157 000 pseudos, les mêmes mots dans les
  quatre langues, donc sans accord grammatical). On le change dans les paramètres (champ et dé), et le réglage **« Afficher le pseudo »** (**non par défaut**: sans ce réglage, seule la date est écrite sous le code) l'affiche; vide ou caché, seule la date reste. Il n'est pas dans le code.
- Même format que le robot: le code est appliqué comme les curseurs et les pastilles (deux messages de trames sur un vrai robot).
- **Le lien vers l'application** (tout en haut des paramètres, comme dans l'application à cartes): deux boutons affichent en plein écran un code QR
  que les élèves scannent pour ouvrir l'application, **« Code QR générique »** (l'adresse `https://francescomondada.github.io/thymio3-learn/`,
  que l'appareil ouvre dans son navigateur: Chrome ou Samsung Internet sur Android) et **« iOS · Bluefy »** (`bluefy://open?url=` et l'adresse,
  pour Bluefy sur iPhone et iPad). L'adresse écrite est celle de GitHub (`APP_URL` dans `src/share.js`), jamais celle de la page courante, pour
  qu'un enseignant sur `localhost` donne quand même un lien qui marche. **Pas de code pour Chrome sur Android** (un lien `intent://` n'est pas
  ouvert par l'appareil photo d'un Samsung); un test l'interdit. **Le format de Bluefy n'est pas vérifié** (à essayer sur un iPad: si `open?url=`
  ne marche pas, `APP_LINKS.ios` est le seul endroit à changer).

## Comment ça marche avec un vrai robot

```
 page  ──(Bluetooth: commande des actionneurs = les 4 LED du corps)──▶  mode sur le robot (ann_xxxxxxxx.py)
 page  ◀─(stdout: lignes "@@…" de 100 octets)──────────────────────────  il dit ses lectures et ses poids
```

Comme dans thymio3-cards: un script qui tourne ne peut rien recevoir par les services Python et fichiers du Bluetooth (ils sont
servis par la tâche qui l'exécute). Le seul chemin vers lui est la **commande des actionneurs**, que le firmware traite
toutes les 20 ms et qui écrit les LED du corps; MicroPython **relit** ces LED (`LEDS_RGB(i).get_intensity_*`).

- **Installation**: le mode (10,6 Ko une fois réduit) est envoyé **une seule fois** comme module (`ann_<hash>.py`, ≈ 4 s);
  un démarrage est ensuite un script de deux lignes, `import ann_x; ann_x.run(30, 667, 16, "")`, dont les arguments portent le
  pas, la vitesse, l'oubli et les 14 poids de départ. Sans module, le mode entier est envoyé.
- **Robot → page** (`parseRobotLine` dans `src/protocol.js`):
  `@@n état p0..p6 gauche droite leçons apprend` toutes les 100 ms (`apprend` vaut 1, ou 0 quand l'apprentissage est gelé, y compris pendant une pause); `@@w` (14 poids, en dixièmes) à chaque changement et toutes les 3 s;
  `@@p pas vitesseG vitesseD oubli` (vitesse de chaque roue sans obstacle); `@@hit masque` (quels capteurs ont touché); `@@learn n`; `@@forget n`; `@@ack n`; `@@state`, `@@exit`, `@@bye`.
- **Page → robot**: un message est une suite d'objets (clé + valeur de 12 bits: un poids en dixièmes, le pas, la vitesse de base de chaque roue (clés 14 et 15, en dixièmes),
  l'oubli, une commande: tout oublier / pause / reprendre / geler / apprendre / quitter), écrite dans les LED en 1 à 8 trames de douze valeurs de 4 bits
  (numéro de message, marqueur à 15, numéro de trame, huit demi-octets, somme de contrôle). Le mode répond `@@ack n`. Un curseur
  qu'on glisse envoie peu de messages: les changements rapprochés sont fusionnés. Un message sans réponse en 0,8 s est renvoyé
  une fois; sinon le mode est **relancé avec le changement**, à partir des derniers poids qu'il a dits (rien n'est perdu).
- **Moteurs**: la commande des actionneurs règle aussi les roues (`SetMotorTargets` dans `ble_spp.c`): chaque message mettrait le
  robot en mouvement à l'arrêt pour un instant. Les trames portent donc les vitesses que le robot vient de dire (`@@n`), et le
  mode redonne les siennes à chaque tick.
- **Lumières**: le canal de réception est le vert de la LED avant gauche (jamais à 15 dans les lumières du mode). Un message fait
  clignoter le corps du robot ≤ 20 ms, et le cercle et les LED Lego sont redessinés au tick suivant.

## Le robot virtuel

`src/sim/arena.js` (une arène, des obstacles, un robot rond à deux roues, sept capteurs dont la lecture suit une courbe qui ressemble
aux vrais: ≈ 4000 au contact, 3300 à 16 mm, rien à 11 cm), `src/sim/ann-mode.js` (le **mode, réécrit en JavaScript**, tick par tick),
`src/sim/virtual-robot.js`, `src/sim/sim-backend.js`. Il produit les mêmes événements que le vrai robot et reçoit les
changements par les mêmes messages (les mêmes trames).

`?fakerobot` dans l'adresse remplace Bluetooth et le robot par un **faux robot** (`src/dev/fake-thymio.js`, même interface que
`thymio3-ts-api`: téléversement du module, lanceur, trames, arrêt…): toute la liaison s'essaie dans un navigateur sans matériel.
`window.fakeRobot.step(n)` fait avancer ce robot de n ticks d'un coup, `window.fakeRobot.flags.live = 'drop'` perd les trames.
(En développement, `window.__learn` donne le magasin et le robot virtuel à la console.)

## Lancer, tester, déployer

```bash
npm install          # l'API Thymio vient de GitHub: github:Mobsya/thymio3-ts-api#main
npm run dev          # http://localhost:5173 (Web Bluetooth demande https ou localhost: Chrome, Edge, Bluefy sur iPhone)
npm test             # JavaScript (node --test), liaison, Python
npm run golden       # réécrit tests/golden-ann.json si le mode Python change
npm run build
```

`.github/workflows/deploy.yml` publie sur GitHub Pages comme les autres projets (pas encore de dépôt).

## Statut — à lire

**Jamais essayé sur un vrai robot.** Vérifié sans robot:

- `tests/test_ann_mode.py` fait tourner **le vrai script Python** sur un robot virtuel (tests/fake_ann_robot.py): mur de face
  (choc, recul de 0,9 à 1 s, leçon, poids), obstacle à gauche ou à droite, capteurs arrière sans choc, oubli (jamais sous 0), vitesse et
  limites, messages de l'interface (poids, réglages, commandes, trames perdues ou fausses, douze objets en huit trames),
  boutons, sortie, lumières (le canal des messages n'est jamais à 15).
- `tests/ann.test.js`: le **port JavaScript fait exactement ce que fait le Python**, tick par tick, sur deux scénarios de 60 s
  (chocs au hasard, boutons, messages): mêmes lignes, mêmes sons, mêmes vitesses.
- `tests/protocol.test.js`: lignes, trames (aller-retour, sommes), objets; le mode **réduit** tel qu'il est envoyé fait la même chose que la source.
- `tests/link.test.js`: la liaison complète (connexion, module installé une fois, lanceur, changements, commandes, curseur glissé,
  trames perdues → relance sans perte) contre le faux robot Bluetooth.
- `tests/arena.test.js`, `tests/store.test.js` (et les textes: aucune clé de langue manquante).
- `tests/share.test.js`, `tests/qr.test.js`, `tests/names.test.js`: le format du code (aller-retour, lecture stricte), un code dessiné puis relu par jsQR, les pseudos.
- La page a été regardée dans un navigateur (ordinateur, 375 × 812, 360 × 640, 844 × 390; clair et sombre; robot virtuel et faux robot).

**Pas vérifié, à regarder avec un vrai robot:**

- le code QR avec **une vraie caméra** (le navigateur de test la bloque): vérifié en lisant une photo du code affiché, pas à travers une caméra, et sur un robot virtuel seulement;
- le débit de la sortie: une ligne de 100 octets toutes les 100 ms, plus les lignes de poids. Le firmware envoie stdout par paquets de
  100 octets; si la liaison peine, la boucle du mode ralentit sans s'arrêter, mais la page serait moins fluide;
- les changements pendant que le robot roule (les trames portent les vitesses courantes; un à-coup des roues serait visible);
- que la courbe des capteurs du robot virtuel ressemble assez aux vrais (elle est de moi, pas mesurée); le seuil de 3300 est celui du firmware;
- que le réseau apprenne utilement dans une vraie pièce (la règle est celle du firmware: elle peut aussi pousser les poids latéraux très haut
  dans une arène étroite, comme on le voit dans le robot virtuel, et le robot n'évite pas toujours mieux après);
- Safari et l'iPhone (il faut Bluefy pour le Bluetooth Web), l'iPad;
- les langues: seulement le français et l'anglais (un dictionnaire de plus suffit pour une autre, `src/i18n.js`).

## Organisation

| Fichier | Rôle |
| --- | --- |
| `src/py/ann_mode.py` | Le mode d'apprentissage en MicroPython, qui tourne sur le robot |
| `src/spec.js` | Capteurs, constantes du firmware, plages des curseurs, cerveaux tout faits |
| `src/protocol.js` | Lignes `@@`, trames dans les LED, objets des messages |
| `src/script.js`, `src/script-core.js` | Le mode comme module (réduit, nom à base de hash) |
| `src/robot/robot-backend-core.js`, `robot-backend.js` | Liaison Web Bluetooth: file d'opérations, module, lanceur, messages, acquittement, repli, journal |
| `src/sim/*` | Arène, mode en JavaScript, robot virtuel |
| `src/dev/fake-thymio.js`, `src/api.js` | Faux robot Bluetooth (`?fakerobot`); `api.js` choisit le vrai ou le faux |
| `src/store.js` | Ce que la page sait du robot et son historique |
| `src/App.jsx` | État, robot virtuel ou réel, clavier, mise en page (onglets sur écran étroit) |
| `src/components/Network.jsx`, `NeuronHelp.jsx`, `RobotBody.jsx` | Le robot et son réseau en une image, le calcul d'un neurone en direct, le dessin du robot (aussi dans l'arène) |
| `src/components/Timeline.jsx`, `chartkit.js` | Les signaux au fil du temps (pile de graphiques alignés) |
| `src/components/ControlBar.jsx`, `Slider.jsx`, `CycleStrip.jsx`, `LinkInfo.jsx`, `Fold.jsx` | La barre de commandes, les curseurs, le cycle et les leçons, le nom et la batterie du robot, les cartes qui se replient |
| `src/components/Arena.jsx`, `Settings.jsx`, `Help.jsx` | Arène, paramètres (langue, thème, diagnostic), aide |
| `src/share.js`, `src/qr.js`, `src/names.js`, `src/components/QrShow.jsx`, `QrScan.jsx` | Le code QR de la configuration (format, dessin et lecture), les pseudos, l'affichage plein écran et le lecteur |
| `src/i18n.js`, `src/styles.css` | Textes (FR, EN) et style (couleurs en jetons, clair et sombre) |
| `tests/` | `node --test`, liaison, Python (`test_ann_mode.py`, `fake_ann_robot.py`) |

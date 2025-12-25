# UI Perf Timer – Utilisation côté navigateur

Ce document décrit :
1. La structure et le comportement de la page `index.html`
2. L’utilisation du script de mesure collé dans la **console du navigateur**
3. Quelques exemples concrets de mesure (clic → popup, loader, etc.)

Aucune installation n’est nécessaire.  
Tout se fait **côté navigateur**, via les DevTools.

---

## 1. Description de l’index.html

La page HTML observée est une interface simple composée de :

- Un **bouton “+”** permettant d’ajouter des éléments à une liste
- Une **liste d’éléments** (`<li class="itemRow">`)
- Chaque élément de la liste est **cliquable**
- Le clic sur un élément affiche une **popup (modal)**
- La popup contient :
  - un titre (`.modalTitle`)
  - un bouton de fermeture

Schéma fonctionnel simplifié :

```

[ Bouton + ]
↓
[ Liste <li class="itemRow"> ]
↓ clic
[ Popup (.modalHead) ]

````

Certains comportements (chargement, délai volontaire, animation) peuvent être présents afin de simuler une application “lourde”.

---

## 2. Principe du script de mesure

Le script est **collé directement dans la console du navigateur** (DevTools).

Il affiche un **panneau flottant** permettant de :

- définir **quand démarrer le chrono**
- définir **quand l’arrêter**
- mesurer un temps **perçu utilisateur** (pas DOM, pas réseau)

### Ce que le script mesure réellement

- ✔ clic utilisateur réel
- ✔ apparition visible d’un élément
- ✔ élément non masqué par un overlay

Ce que le script ne mesure pas :

- DOMContentLoaded
- événements réseau
- métriques Lighthouse

---

## 3. Démarrage du script

1. Ouvrir la page `index.html`
2. Ouvrir les DevTools (F12)
3. Onglet **Console**
4. Coller le script de mesure
5. Valider (Entrée)

Un **panneau “Perf Timer”** apparaît en bas à droite de la page.

---

## 4. Configuration du panneau

### START – démarrage du chrono

Le chrono démarre **lors d’un clic** sur un élément qui correspond à un sélecteur CSS.

Exemples :

- Bouton `+` :
```css
#addBtn
````

* Tous les items de la liste :

```css
li.itemRow
```

* Le 6ᵉ item uniquement :

```css
li.itemRow:nth-of-type(6)
```

> Le clic peut être fait sur l’élément ou n’importe lequel de ses enfants.

---

### STOP – arrêt du chrono

Le chrono s’arrête lorsqu’un élément correspondant au sélecteur devient vrai selon un mode.

Sélecteurs courants :

```css
.modalHead
#modalTitle
#closeBtn
```

#### Modes disponibles

* `visible` → élément réellement visible à l’écran (recommandé)
* `present` → élément présent dans le DOM
* `hidden` → élément masqué
* `gone` → élément supprimé du DOM

---

## 5. Utilisation typique

### Exemple 1 — Mesurer clic → popup visible

Objectif : mesurer le temps entre le clic sur un item et l’affichage de la popup.

Configuration :

| Champ          | Valeur       |
| -------------- | ------------ |
| START selector | `li.itemRow` |
| STOP selector  | `.modalHead` |
| STOP mode      | `visible`    |

Procédure :

1. Cliquer **Arm**
2. Cliquer un item dans la liste
3. Le chrono démarre au clic
4. Il s’arrête quand la popup est visible

---

### Exemple 2 — Mesurer un item précis

Mesurer uniquement le 6ᵉ élément de la liste :

```css
li.itemRow:nth-of-type(6)
```

À placer dans **START selector**.

---

### Exemple 3 — Mesurer un chargement (loader)

Si la page affiche un loader :

| Champ          | Valeur            |
| -------------- | ----------------- |
| START selector | `#loadingOverlay` |
| START mode     | `visible`         |
| STOP selector  | `#loadingOverlay` |
| STOP mode      | `hidden`          |

Procédure :

1. Cliquer **Arm**
2. Recharger la page
3. Le chrono mesure la durée réelle d’affichage du loader

---

## 6. Persistance

* Les réglages sont sauvegardés dans `localStorage`
* Après un reload :

  * il suffit de **recoller le script**
  * la configuration est restaurée automatiquement

---

## 7. Pourquoi cet outil

* mesurer des délais perçus
* comprendre des écarts entre “timings navigateur” et ressenti utilisateur
* investiguer des comportements UI
* travailler dans des environnements verrouillés (sans install)

---

## 8. Limites connues

* le script doit être ré-injecté après chaque reload
* nécessite des sélecteurs CSS stables
* pas conçu pour de la mesure automatisée massive

---

> **Philosophie :**
> mesurer ce que l’utilisateur voit et ressent, pas ce que le navigateur annonce.

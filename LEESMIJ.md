# Kaartkluis

Gratis app om je Pokémon-kaarten bij te houden: kaarten scannen, per set zien wat je nog mist (ook promo's zoals de Scarlet & Violet Black Star Promos), in meerdere talen, en gesynchroniseerd tussen je toestellen.

Kaartgegevens en afbeeldingen komen van [TCGdex](https://tcgdex.dev), een gratis open databank. Er zijn geen kosten en er is geen API-sleutel nodig.

---

## 1. Online zetten met GitHub Pages (gratis, ±5 minuten)

1. Ga naar <https://github.com/new> (aangemeld als **veysbrandon10-rgb**).
2. Repository name: `kaartkluis`. Zet hem op **Public** (GitHub Pages is gratis voor publieke repo's). Klik **Create repository**.
3. Klik op **uploading an existing file**, sleep **alle bestanden en de map `icons`** uit deze zip erin, en klik **Commit changes**.
4. Ga naar **Settings → Pages**. Kies bij *Source*: **Deploy from a branch**, branch **main**, map **/ (root)**. Klik **Save**.
5. Na een minuutje staat de app op: **https://veysbrandon10-rgb.github.io/kaartkluis/**

## 2. Installeren op je Android-gsm

1. Open het adres hierboven in **Chrome**.
2. Tik op **⋮ → App installeren** (of **Toevoegen aan startscherm**).
3. Kaartkluis staat nu als app op je startscherm. Bij de eerste scan vraagt hij toestemming voor de camera.

## 3. Synchroniseren tussen toestellen (optioneel, gratis, ±10 minuten)

Zonder deze stap werkt alles, maar staat je collectie alleen op het toestel waar je ze ingeeft (maak dan af en toe een back-up via Instellingen).

Synchroniseren gebeurt via een eigen gratis Firebase-project (Google). Het gratis "Spark"-abonnement is ruim genoeg; je hoeft geen betaalkaart op te geven.

1. Ga naar <https://console.firebase.google.com> en klik **Project maken**. Naam bv. `kaartkluis`. Google Analytics mag uit.
2. **Aanmelden aanzetten:** menu **Build → Authentication → Aan de slag → Sign-in method → Google → Inschakelen**, kies je e-mailadres als supportadres, **Opslaan**.
3. **Toegestaan webadres:** in Authentication → **Settings → Authorized domains → Add domain** → `veysbrandon10-rgb.github.io`.
4. **Database maken:** menu **Build → Firestore Database → Database maken**. Locatie: **europe-west1 (Belgium)**. Kies **productiemodus**.
5. **Beveiligingsregels:** in Firestore → tabblad **Regels**, vervang alles door onderstaande tekst en klik **Publiceren**. (Deze knop staat ook in de app: Instellingen → *Kopieer beveiligingsregels*.)

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /collections/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   Zo kan iedereen alleen zijn eigen collectie lezen en wijzigen.
6. **Web-app toevoegen:** ga naar het tandwiel **Projectinstellingen → Algemeen → Je apps → `</>` (Web)**. Bijnaam `kaartkluis`, Hosting níet aanvinken, **App registreren**.
7. Je ziet nu een stuk code met `const firebaseConfig = { apiKey: "...", authDomain: "...", ... }`. Kopieer het deel tussen de `{ }`.
8. Open Kaartkluis → **Instellingen → Synchroniseren**, plak de config en tik **Opslaan en verbinden**, dan **Aanmelden met Google**.
9. Doe stap 8 op elk toestel (gsm, pc, tablet). Aanmelden met hetzelfde Google-account = dezelfde collectie.

Gezinsleden melden zich met hun eigen Google-account aan en hebben zo elk een eigen collectie in dezelfde app.

> De Firebase-config is geen geheim wachtwoord; hij staat bij elke Firebase-webapp gewoon in de pagina. De beveiliging zit in de regels van stap 5.

---

## Zo werkt het

- **Sets:** kies bovenaan de taal van je kaarten. Per reeks zie je de sets met je voortgang. Promo's staan als aparte set in hun reeks (bv. *SVP Black Star Promos* onder Scarlet & Violet).
- **Wat mis ik nog:** open een set en tik **Ontbrekend**. Met **Kopieer lijst ontbrekend** heb je meteen een lijstje om te ruilen of te kopen.
- **Snel afvinken:** zet dit aan om met één tik een kaart in bezit of weg te zetten, handig met je binder naast je.
- **Scannen:** leg de kaart in het kader zodat het nummer onderaan (bv. `045/198` of `SVP EN 085`) scherp in de gestippelde strook staat, en tik **Scan kaart**. De app leest het nummer, zoekt de kaart op en toont een voorstel. Twijfelt hij, dan kies je zelf uit 2–3 kaarten. **Doorlopend scannen** + **Meteen toevoegen** is handig voor een hele stapel.
- **Talen door elkaar:** een Japanse of Chinese kaart scan je door eerst die taal te kiezen (knopjes boven de camera). Je collectie houdt elke taal apart bij.
- **Offline:** sets en afbeeldingen die je al eens bekeek, blijven op je gsm bewaard.

## Goed om te weten

- De scanner leest het **kaartnummer**, niet de tekening. Bij goed licht en zonder schittering werkt dat betrouwbaar. Bij glimmende kaarten in een hoes helpt het om de hoes even uit te doen of de lamp-knop te gebruiken.
- De eerste scan laadt het herkenningsprogramma (± 5 MB). Daarna gaat het sneller.
- Bij Japanse en Chinese kaarten gebruikt de app alleen het nummer (niet de naam) om te zoeken. Hebben twee sets hetzelfde aantal kaarten, dan kies je zelf.
- Hoe volledig een taal is, hangt af van TCGdex. Engels, Frans, Duits, Italiaans en Spaans zijn het meest compleet; bij Nederlands en sommige Aziatische sets kan een afbeelding ontbreken.
- Reverse holo en andere varianten worden (nog) niet apart geteld: één kaart = één nummer.

Deze app is niet verbonden aan Nintendo, Creatures, GAME FREAK of The Pokémon Company.

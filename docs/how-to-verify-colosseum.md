# Cómo comprobar y ver el Colosseum (COLOSSEUM-1)

Guía corta para ver el incremento Week 3 / COLOSSEUM-1 en local.

## 1. Comprobar que está en `main` y es conocido-bueno

```bash
git fetch --tags origin
git log --oneline -3 origin/main
git rev-parse origin/main origin/known-good      # ambos deben coincidir
```

El tag `known-good` identifica la última revisión que pasó **los dos gates**
(verificación mecánica + review adversarial).

## 2. Correr el gate mecánico (comprobación reproducible)

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22   # el repo exige Node >= 20.18
npm ci                                     # usa el lockfile commiteado
./scripts/verify.sh
```

Debe terminar en `VERIFICATION PASSED` (typecheck, lint, unit, acceptance,
regression, build, forge build, forge test).

> Nota: usa `npm ci`, no `npm install` — `npm install` puede reescribir el
> `package-lock.json` y romper el build.

## 3. Verlo en el navegador

### 3.1 Configurar el entorno

```bash
cp .env.example .env.local
```

Rellena en `.env.local` (las claves de Supabase las suministra el proyecto):

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...     # requerido por Colosseum (ver abajo)
KADE_FEE_MODE=demo
KADE_CHAIN_ENV=testnet
KADE_COLOSSEUM=1                  # enciende la superficie Colosseum
```

⚠️ **`SUPABASE_SERVICE_ROLE_KEY` es requisito del flujo Colosseum.** Los RPCs de
elegibilidad son *server-only* (`service_role`), así que sin esta clave la
feature queda inerte y los actions responden "not-configured" honestamente. Es
lo que hace real la propiedad "elegibilidad juzgada en servidor".

Sin `KADE_COLOSSEUM=1`, `/colosseum` es un **404** y el item de nav no aparece.

### 3.2 Arrancar

```bash
npm run dev      # http://localhost:3000
```

### 3.3 Recorrer el flujo

1. Inicia sesión (Google OAuth o email magic link).
2. Si no has completado el onboarding, completa los pasos previos; el
   `/colosseum` redirige a `/onboarding` sin aplicación.
3. Ve a **`/colosseum`** (aparece en el nav bajo "Residency").
4. **Register for Colosseum Residency** → fija tu tier a `colosseum` (10 USDC).
5. Deposita/ten una posición cualificada **≥ 10 USDC** (Invest / Morpho). El
   check `funds` se pone en verde.
6. Cuando `funds` está en verde pero faltan los otros checks, aparece el
   **pop-up** que apunta a los pasos reales de residencia (`/residency`).
7. Completa los **cuatro checks reales** (`identity`, `funds`, `review`,
   `service-fee`). Al estar los cuatro en verde:
   - pantalla de carga → **"You're a Colosseum Resident"** con la frase
     *"Remain a compliant resident for 2 minutes to be eligible to become a
     Colosseum Citizen."*
8. Espera los **2 minutos** (el contador se persiste; sobrevive recargas) y
   pulsa **Become a Citizen** → animación + **pasaporte virtual guardado**.

### 3.4 Comprobación rápida por tests (sin navegador)

```bash
cd apps/web
npx vitest run tests/colosseum-residency.test.tsx \
              tests/colosseum-citizenship.test.tsx \
              tests/colosseum-actions.test.ts \
              tests/colosseum-nav.test.tsx \
              tests/colosseum-page.test.tsx
```

## 4. Ver la review y el contrato

- Sesión de review (evidencia de la promoción):
  `.review/week3-colosseum-resident-citizen/{state,findings}.yaml`
- Contrato del incremento: `docs/week-3-frozen-delivery-contract.md` §8
- Doc de la feature: `docs/colosseum-residency.md`
- Divergencia declarada / gaps: `docs/known-gaps.md`

## 5. Límites (declarado)

Colosseum **Resident/Citizen** y el **pasaporte virtual** son constructos de
hackathon demo: no confieren residencia, ciudadanía, estatus legal ni registro
on-chain. El mínimo de **10 USDC es un valor de hackathon**, no el mínimo de un
permiso de producción. Convertirlo en real es un item de change control
(contrato §8.6).

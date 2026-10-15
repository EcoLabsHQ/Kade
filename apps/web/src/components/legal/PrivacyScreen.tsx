import { tokens } from '@/components/ui/tokens';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { SiteFooter } from '@/components/shell/SiteFooter';

/**
 * The public Privacy Policy page.
 *
 * Standalone and session-free: it reads no resident data, so it renders for an
 * unauthenticated visitor (the route is listed in `PUBLIC_PATHS`, see
 * `@/lib/routing`). It carries no sidebar/shell chrome; like the login screen it
 * composes `ContentContainer` + `SiteFooter`, so the global footer — and the
 * Privacy link inside it — are present here too.
 *
 * This is the draft policy text the human supplied the hosting entity for; the
 * "Last updated" date is a fixed legal date, not render-time.
 */
const LAST_UPDATED = '15 October 2026';
const ENTITY = 'EcoLabs B.V.';
const ENTITY_ADDRESS = 'Kaya Seru Cueba 20, 0000cw, Willemstad, Curaçao';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: '26px' }}>
      <h2
        style={{
          margin: '0 0 6px',
          fontSize: '16px',
          fontWeight: 700,
          letterSpacing: '-.01em',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

const paragraph = {
  margin: '0 0 10px',
  color: tokens.chipFg,
  fontSize: '14px',
  lineHeight: 1.6,
  maxWidth: '72ch',
  textWrap: 'pretty' as const,
};

const list = {
  margin: '0 0 10px',
  paddingLeft: '20px',
  color: tokens.chipFg,
  fontSize: '14px',
  lineHeight: 1.6,
  maxWidth: '72ch',
};

export function PrivacyScreen() {
  return (
    <div
      className="kade-shell"
      style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'stretch' }}
    >
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <ContentContainer footer={<SiteFooter />}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: tokens.muted,
            }}
          >
            Legal
          </div>

          <h1
            style={{
              margin: '8px 0 6px',
              fontSize: '30px',
              fontWeight: 700,
              letterSpacing: '-.02em',
            }}
          >
            Privacy Policy
          </h1>

          <p style={{ ...paragraph, color: tokens.muted }}>
            {ENTITY} · Last updated {LAST_UPDATED}
          </p>

          <Section title="Who we are">
            <p style={paragraph}>
              Onchain Island is a residency platform powered by Kade. It is
              operated and hosted by {ENTITY}, {ENTITY_ADDRESS} (&ldquo;we&rdquo;,
              &ldquo;us&rdquo;). This policy explains what personal data we
              collect, why we collect it, and how we handle it.
            </p>
          </Section>

          <Section title="Information we collect">
            <ul style={list}>
              <li>
                <strong>Account and sign-in.</strong> We use Supabase for
                authentication. You sign in with Google. We process your email
                address, the sign-in provider you use, and an internal account
                identifier.
              </li>
              <li>
                <strong>Residency application and profile.</strong> When you
                apply, we collect your first name, last name, date of birth,
                gender, countries of citizenship, countries of residence (with
                the years you lived there), the residency tier you select, and —
                where you add them — details of the household members you name
                (their name, relationship, date of birth, citizenship and
                gender).
              </li>
              <li>
                <strong>Identity verification.</strong> We use Self (self.xyz) to
                verify your passport. From that verification we receive your
                nationality, whether you are over 18, the outcome of a sanctions
                check, your passport expiry date, and a per-person pseudonymous
                identifier (a &ldquo;nullifier&rdquo;). The passport proof itself
                is processed by Self; we do not store your raw passport document.
              </li>
              <li>
                <strong>Wallet and account data.</strong> We store the blockchain
                addresses you connect or paste (EVM and Bitcoin), wallet
                ownership signatures, your Safe smart-account address and its
                deployment details, and records of fee payments including
                transaction hashes.
              </li>
              <li>
                <strong>Signing.</strong> We store a passkey public key and
                credential identifier. Your private key never leaves your device.
              </li>
              <li>
                <strong>Documents.</strong> Where a document is provided, we
                store metadata only — its type, owner, a content hash and an
                identifier — not the document bytes.
              </li>
              <li>
                <strong>Review records.</strong> We keep internal records of the
                review of your application.
              </li>
            </ul>
          </Section>

          <Section title="How we use your information">
            <p style={paragraph}>
              We use it to operate the platform; verify your identity and
              eligibility; create and manage your Safe account; process fees;
              keep records; comply with legal obligations; and keep the service
              secure. We do not use your data for advertising.
            </p>
          </Section>

          <Section title="On-chain and public data">
            <p style={paragraph}>
              Some data is written to public blockchains — for example your Safe
              address, fee transactions, and, if and when enabled, an identity
              attestation and a membership credential. Public blockchains are
              public and append-only: records written to them cannot be deleted
              or altered, and remain visible even after you close your account.
              Do not treat anything you write on-chain as private.
            </p>
          </Section>

          <Section title="Who we share it with">
            <p style={paragraph}>
              We share personal data only with service providers that help us run
              the platform, and only as needed:
            </p>
            <ul style={list}>
              <li>Supabase — authentication and database.</li>
              <li>Vercel — application hosting.</li>
              <li>Google — sign-in with Google.</li>
              <li>Self (self.xyz) — passport and identity verification.</li>
              <li>Blockchain RPC providers — reading and writing to the blockchain.</li>
              <li>Pimlico — account abstraction (gas) for your Safe.</li>
              <li>Reown / WalletConnect — connecting a browser wallet.</li>
              <li>mempool.space and a blockchain explorer — read-only balance lookups.</li>
              <li>Snapshot — governance.</li>
              <li>A country-flag image service — country flag images in the interface.</li>
            </ul>
            <p style={paragraph}>We do not sell your personal data.</p>
          </Section>

          <Section title="Cookies and local storage">
            <p style={paragraph}>
              We use sign-in session cookies (set by Supabase) to keep you signed
              in, and a browser session-storage entry that holds a pending fee
              transaction hash while a payment is in progress. We do not use
              advertising or analytics trackers.
            </p>
          </Section>

          <Section title="Retention">
            <p style={paragraph}>
              We keep personal data for as long as needed to provide the service
              and meet our legal obligations, then delete or anonymise it. Data
              written to a public blockchain cannot be deleted (see &ldquo;On-chain
              and public data&rdquo;).
            </p>
          </Section>

          <Section title="Your rights">
            <p style={paragraph}>
              Subject to applicable law, you may request access to, correction
              of, or deletion of your personal data, and you may object to certain
              processing. Some requests are limited by our legal obligations and
              by the immutability of on-chain records. To make a request, contact
              us at the address below.
            </p>
          </Section>

          <Section title="Security">
            <p style={paragraph}>
              We use reasonable technical and organisational measures to protect
              personal data, including passkeys for signing. No system is
              completely secure, so we cannot guarantee absolute security.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p style={paragraph}>
              We may update this policy. We will change the &ldquo;Last
              updated&rdquo; date and, where a change is significant, provide
              notice.
            </p>
          </Section>

          <Section title="Contact">
            <p style={paragraph}>
              Questions about this policy or your personal data can be sent to us
              at:
            </p>
            <address
              style={{
                margin: '0',
                fontStyle: 'normal',
                color: tokens.chipFg,
                fontSize: '14px',
                lineHeight: 1.6,
              }}
            >
              {ENTITY}
              <br />
              {ENTITY_ADDRESS}
            </address>
          </Section>
        </ContentContainer>
      </main>
    </div>
  );
}

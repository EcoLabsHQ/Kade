import { tokens } from '@/components/ui/tokens';

export type StepperItemState = 'done' | 'active' | 'locked';

export interface StepperItem {
  readonly title: string;
  readonly state: StepperItemState;
  readonly lockReason?: string;
}

export interface PreRegistrationStepperProps {
  readonly items: readonly StepperItem[];
}

/**
 * The pre-registration stepper rail, shown in the sidebar while onboarding.
 *
 * Steps that are reached render as done or active; unreached steps are shown
 * locked — greyed `#98A2B3`, `cursor: not-allowed`, with the reason in the
 * `title` — never hidden (handoff "Interactions & behaviour").
 */
export function PreRegistrationStepper({ items }: PreRegistrationStepperProps) {
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: tokens.muted,
          padding: '6px 12px 8px',
        }}
      >
        Resident setup
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {items.map((item, index) => {
          const mark = item.state === 'done' ? '✓' : String(index + 1);
          const circleBackground =
            item.state === 'done' ? tokens.brandPrimary : '#fff';
          const circleColor =
            item.state === 'done'
              ? '#fff'
              : item.state === 'active'
                ? tokens.brandPrimary
                : tokens.muted;
          const circleBorder =
            item.state === 'locked' ? '#D9DFE7' : tokens.brandPrimary;
          const titleColor =
            item.state === 'active'
              ? tokens.brandPrimary
              : item.state === 'done'
                ? tokens.ink
                : tokens.locked;

          const content = (
            <>
              <span
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: circleBackground,
                  color: circleColor,
                  border: `1.5px solid ${circleBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 700,
                }}
              >
                {mark}
              </span>
              <span
                style={{ fontSize: '13.5px', fontWeight: 500, color: titleColor }}
              >
                {item.title}
              </span>
            </>
          );

          if (item.state === 'locked') {
            return (
              <button
                key={item.title}
                type="button"
                disabled
                aria-disabled="true"
                title={item.lockReason}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr',
                  gap: '10px',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: 0,
                  borderRadius: '10px',
                  background: 'transparent',
                  fontFamily: 'inherit',
                  cursor: 'not-allowed',
                  opacity: 0.7,
                }}
              >
                {content}
              </button>
            );
          }

          return (
            <div
              key={item.title}
              aria-current={item.state === 'active' ? 'step' : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: '22px 1fr',
                gap: '10px',
                alignItems: 'center',
                padding: '8px 12px',
                borderRadius: '10px',
                background:
                  item.state === 'active' ? tokens.activeNavBg : 'transparent',
              }}
            >
              {content}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

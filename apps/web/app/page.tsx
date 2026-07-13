import Link from 'next/link';
import Script from 'next/script';

import styles from './page.module.css';

const attributionScript = `(() => {
  const source = new URLSearchParams(window.location.search).get('src');
  if (source) window.sessionStorage.setItem('fw_attribution', source);
})();`;

const steps = [
  {
    number: '01',
    title: '친구가 녹음해요',
    body: '나를 오래 본 친구가 직접 목소리로 소개를 남깁니다.',
  },
  {
    number: '02',
    title: '당사자가 승인해요',
    body: '공개될 문장과 사진을 당사자가 확인하고 결정합니다.',
  },
  {
    number: '03',
    title: '링크로 공유해요',
    body: '승인된 소개만 하나의 링크가 되어 친구의 말투 그대로 전달됩니다.',
  },
] as const;

function VoiceMark() {
  return (
    <svg className={styles.voiceMark} viewBox="0 0 360 120" aria-hidden="true">
      {[34, 58, 88, 46, 76, 104, 64, 42, 92, 72, 108, 52, 82, 62, 96, 38].map((height, index) => (
        <rect
          key={`${height}-${index}`}
          x={index * 22 + 4}
          y={(120 - height) / 2}
          width="12"
          height={height}
          rx="6"
        />
      ))}
    </svg>
  );
}

export default function HomePage() {
  return (
    <>
      <Script id="friendword-attribution" strategy="afterInteractive">
        {attributionScript}
      </Script>
      <main className={styles.page} lang="ko">
        <header className={styles.nav}>
          <Link className={styles.wordmark} href="/" aria-label="Friendword 홈">
            Friendword
          </Link>
          <Link className={styles.quietLink} href="/p/demo-blair">
            데모 보기
          </Link>
        </header>

        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Dating, in your friends&apos; words.</p>
            <h1 id="hero-heading">
              <span>친구의 목소리로</span>
              <span>시작되는 소개</span>
            </h1>
            <p className={styles.heroBody}>
              나를 아는 친구의 진짜 말투, 공개 전 당사자의 승인, 그리고 필요한 만큼만 이어지는 연결.
              Friendword는 소개의 시작을{' '}
              <span className={styles.noBreak}>더 사람답게 만듭니다.</span>
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/p/demo-blair">
                데모 피치 들어보기
                <span aria-hidden="true">→</span>
              </Link>
              <Link className={styles.secondaryAction} href="#how-it-works">
                어떻게 작동하나요?
              </Link>
            </div>
          </div>

          <div className={styles.voiceCard} aria-label="Friendword 음성 소개 미리보기">
            <div className={styles.voiceCardTopline}>
              <span>FROM A FRIEND</span>
              <span>01:00</span>
            </div>
            <VoiceMark />
            <div className={styles.voiceQuote}>
              <span className={styles.quoteMark} aria-hidden="true">
                “
              </span>
              <span>평범한 화요일도</span>
              <span>오래 기억할 이야기로</span>
              <span>만드는 사람이에요.</span>
            </div>
            <div className={styles.approvalLine}>
              <span className={styles.approvalDot} aria-hidden="true" />
              당사자가 공개 내용을 확인한 소개
            </div>
          </div>
        </section>

        <section className={styles.stepsSection} id="how-it-works" aria-labelledby="steps-heading">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>HOW IT WORKS</p>
            <h2 id="steps-heading">소개는 이렇게 시작돼요</h2>
          </div>
          <div className={styles.stepsGrid}>
            {steps.map((step) => (
              <article className={styles.stepCard} key={step.number}>
                <span className={styles.stepNumber}>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.demoBand} aria-labelledby="demo-heading">
          <div>
            <p className={styles.kicker}>A REALISTIC DEMO</p>
            <h2 id="demo-heading">설명보다 먼저, 한 사람의 소개를 들어보세요.</h2>
            <p>Blair의 데모에는 친구의 음성, 승인된 사진과 소개 문장이 담겨 있습니다.</p>
          </div>
          <Link className={styles.secondaryAction} href="/p/demo-blair">
            Blair 데모 열기
            <span aria-hidden="true">↗</span>
          </Link>
        </section>

        <section className={styles.safetySection} aria-labelledby="safety-heading">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>BUILT AROUND CONSENT</p>
            <h2 id="safety-heading">당사자가 결정합니다</h2>
            <p>
              소개를 만든 친구가 아니라, 소개되는 당사자가 공개 여부와 공개할 사진을 선택합니다.
            </p>
          </div>
          <div className={styles.safetyGrid}>
            <article>
              <span className={styles.safetyIcon} aria-hidden="true">
                01
              </span>
              <h3>공개 전 동의</h3>
              <p>당사자가 승인하기 전에는 캠페인 링크가 공개되지 않습니다.</p>
            </article>
            <article>
              <span className={styles.safetyIcon} aria-hidden="true">
                02
              </span>
              <h3>사진과 문장 통제</h3>
              <p>승인할 버전과 공개할 사진을 당사자가 직접 선택합니다.</p>
            </article>
            <article>
              <span className={styles.safetyIcon} aria-hidden="true">
                03
              </span>
              <h3>가입 없이 열람</h3>
              <p>공개 소개는 로그인 없이 볼 수 있습니다. 관심 표현부터 프로필이 필요합니다.</p>
            </article>
          </div>
        </section>

        <section className={styles.appSection} aria-labelledby="app-heading">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>WHAT&apos;S NEXT</p>
            <h2 id="app-heading">iOS 앱 준비 중</h2>
            <p>아직 App Store 출시 전입니다. 지금은 데모로 확인해 보세요.</p>
          </div>

          <div className={styles.pathGrid}>
            {/* These stable anchors can become universal-link destinations when the iOS app ships. */}
            <article className={styles.pathCard} id="pitch-a-friend">
              <p className={styles.pathLabel}>친구를 소개하고 싶다면</p>
              <h3>친구의 좋은 점을 목소리로 남겨보세요.</h3>
              <p>앱에서 녹음과 사진을 준비해 당사자에게 승인을 요청합니다.</p>
              <span className={styles.comingSoon}>iOS에서 준비 중</span>
            </article>

            <article className={styles.pathCard} id="create">
              <p className={styles.pathLabel}>내 소개를 받은 뒤에도</p>
              <h3>이번에는 내가 다른 친구를 소개할 수 있어요.</h3>
              <p>소개받는 사람도 다음 Friendword에서는 친구를 소개하는 사람이 됩니다.</p>
              <Link className={styles.textLink} href="/p/demo-blair">
                먼저 데모 체험하기 <span aria-hidden="true">→</span>
              </Link>
            </article>
          </div>
        </section>

        <footer className={styles.footer}>
          <p className={styles.footerWordmark}>Friendword</p>
          <p>친구의 목소리로 시작되는 소개</p>
        </footer>
      </main>
    </>
  );
}

import { MessageSquare, Image, Mic, Smartphone, Users, Search } from 'lucide-react';
import styles from './LandingDetails.module.css';

export default function LandingDetails() {
  return (
    <div className={styles.details}>
      <nav className={styles.sectionNav} aria-label="Explore Chat">
        <a href="#messaging">Messaging</a>
        <a href="#sharing">Sharing</a>
        <a href="#mobile">Mobile</a>
        <a href="#questions">FAQs</a>
      </nav>
      <section id="messaging" className={styles.section}>
        <div className={styles.heading}>
          <span>KEEP EVERYONE CONNECTED</span>
          <h2>A place for every conversation.</h2>
          <p>
            Talk one to one, bring a group together, or give your team a shared space. Threads and
            reactions keep the conversation easy to follow.
          </p>
        </div>
        <div className={styles.cards}>
          <article>
            <MessageSquare />
            <h3>Stay in the flow</h3>
            <p>
              Send a quick message, reply in a thread, and pick the right reaction from a full emoji
              library.
            </p>
          </article>
          <article>
            <Users />
            <h3>Bring your people</h3>
            <p>
              Invite a friend by email and share the conversation link. They sign in with Google and
              join with their invited email.
            </p>
          </article>
          <article>
            <Search />
            <h3>Find it again</h3>
            <p>
              Search your available conversations by person, words, date, or shared files. Star a
              message to keep it close.
            </p>
          </article>
        </div>
      </section>
      <section id="sharing" className={`${styles.section} ${styles.soft}`}>
        <div className={styles.heading}>
          <span>MORE THAN WORDS</span>
          <h2>Show it. Say it. Share it.</h2>
          <p>A picture can explain the idea. A voice message can add the context.</p>
        </div>
        <div className={styles.cards}>
          <article>
            <Image />
            <h3>Send the full picture</h3>
            <p>
              Share images and files up to 5 MB each. Open a larger image preview and download the
              original.
            </p>
          </article>
          <article>
            <Mic />
            <h3>Make room for your voice</h3>
            <p>
              Record up to two minutes, listen before sending, or attach an audio file. Play, seek,
              and change the speed when listening.
            </p>
          </article>
        </div>
      </section>
      <section id="mobile" className={styles.section}>
        <div className={styles.heading}>
          <Smartphone />
          <h2>Your conversations, wherever you are.</h2>
          <p>
            Use Chat in your browser or add it to your phone’s Home Screen. The layout adapts to
            your screen, with light and dark appearances.
          </p>
        </div>
        <div className={styles.steps}>
          <article>
            <b>1</b>
            <h3>Open and sign in</h3>
            <p>Continue with your Google account. Your friend can use the same app link.</p>
          </article>
          <article>
            <b>2</b>
            <h3>Add to Home Screen</h3>
            <p>
              On iPhone, open Safari, tap Share, then Add to Home Screen. In Android Chrome, choose
              Install app when offered.
            </p>
          </article>
          <article>
            <b>3</b>
            <h3>Start talking</h3>
            <p>
              Choose New chat, add their email, and share the invitation link. Messages sync while
              the app is open and connected.
            </p>
          </article>
        </div>
      </section>
      <section id="questions" className={styles.faq}>
        <h2>A few things to know.</h2>
        <details>
          <summary>Do I need to install anything?</summary>
          <p>
            You can use the app directly in your browser. Adding it to your Home Screen is optional.
          </p>
        </details>
        <details>
          <summary>Can I use my existing Google Chat conversations?</summary>
          <p>
            This is an independent messenger. Your conversations and files stay in this app; Google
            sign-in connects your identity.
          </p>
        </details>
        <details>
          <summary>What happens when I lose my connection?</summary>
          <p>
            If a send isn’t confirmed, your draft stays available on this device. Check your
            connection and press Send to retry.
          </p>
        </details>
        <details>
          <summary>Which files can I share?</summary>
          <p>
            PNG, JPG, GIF and WebP images, PDFs, text files, and supported audio files. Each message
            can include up to three attachments, each up to 5 MB.
          </p>
        </details>
      </section>
    </div>
  );
}

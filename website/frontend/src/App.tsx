import { Tabs } from '@mantine/core';
import styles from './App.module.css';

// Disposable observations from the approved HTML mocks, without service calls.
const account = {
  name: 'Alex Morgan',
  total: 130_450,
  cash: 76_450,
  reservedCash: 5_500,
  quantity: 480,
  price: 112.5,
};
const euros = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
});

export function App() {
  return (
    <div className={styles.app}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="PQC Trading overview">
          pqc.trading<span>_</span>
        </a>
        <nav aria-label="Main navigation">
          <a className={styles.navLink} href="/" aria-current="page">
            Overview
          </a>
        </nav>
        <span className={styles.identity}>{account.name}</span>
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        <h1 className={styles.srOnly}>Overview</h1>
        <div className={styles.metrics}>
          <article className={styles.metric}>
            <h2>Total account value</h2>
            <p>{euros.format(account.total)}</p>
          </article>
          <article className={styles.metric}>
            <h2>Available cash</h2>
            <p>{euros.format(account.cash - account.reservedCash)}</p>
          </article>
          <article className={styles.metric}>
            <h2>QC holdings</h2>
            <p>
              {account.quantity} <small>QC</small>
            </p>
          </article>
        </div>
        <section className={styles.panel} aria-labelledby="account-title">
          <div className={styles.panelHeading}>
            <h2 id="account-title">Your account</h2>
            <span className={styles.sample}>Sample data</span>
          </div>
          <Tabs
            defaultValue="holdings"
            classNames={{
              list: styles.tabList,
              tab: styles.tab,
              panel: styles.tabPanel,
            }}
          >
            <Tabs.List aria-label="Account details">
              <Tabs.Tab value="holdings">Holdings</Tabs.Tab>
              <Tabs.Tab value="cash">Cash</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="holdings">
              <dl className={styles.details}>
                <div>
                  <dt>Asset</dt>
                  <dd>
                    Quant Coin <span>QC</span>
                  </dd>
                </div>
                <div>
                  <dt>Quantity</dt>
                  <dd>{account.quantity} QC</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>{euros.format(account.price)}</dd>
                </div>
                <div>
                  <dt>Value</dt>
                  <dd>{euros.format(account.quantity * account.price)}</dd>
                </div>
              </dl>
            </Tabs.Panel>
            <Tabs.Panel value="cash">
              <dl className={styles.details}>
                <div>
                  <dt>Total cash</dt>
                  <dd>{euros.format(account.cash)}</dd>
                </div>
                <div>
                  <dt>Reserved in orders</dt>
                  <dd>{euros.format(account.reservedCash)}</dd>
                </div>
                <div>
                  <dt>Available cash</dt>
                  <dd>{euros.format(account.cash - account.reservedCash)}</dd>
                </div>
              </dl>
            </Tabs.Panel>
          </Tabs>
        </section>
      </main>
      <footer className={styles.footer}>
        <a href="https://praguequantclub.org/">Prague Quant Club</a>
        <div>
          <a
            href="https://instagram.com/praguequantclub"
            target="_blank"
            rel="noreferrer"
          >
            Instagram ↗
          </a>
          <a
            href="https://linkedin.com/company/prague-quant-club"
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn ↗
          </a>
        </div>
      </footer>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { BenchPage } from './bench/BenchPage';
import { HomePage } from './HomePage';

function currentRoute(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function App() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route === '/bench' ? <BenchPage /> : <HomePage />;
}

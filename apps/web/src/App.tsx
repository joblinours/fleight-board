import { useEffect, useState } from 'react';
import { BenchPage } from './bench/BenchPage';
import { BoardPage } from './board/BoardPage';
import { HomePage } from './HomePage';
import { InkPage } from './ink/InkPage';

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

  switch (route) {
    case '/bench':
      return <BenchPage />;
    case '/ink':
      return <InkPage />;
    case '/board':
      return <BoardPage />;
    default:
      return <HomePage />;
  }
}

import { Component, useState, type ReactNode } from "react";
import { CaptureScreen } from "./components/CaptureScreen";
import { FamilyScreen } from "./components/FamilyScreen";
import { FeatureScreen } from "./components/FeatureScreen";
import { HomeScreen } from "./components/HomeScreen";
import { ResultsScreen } from "./components/ResultsScreen";
import { PeopleProvider, usePeople } from "./state";
import { uid, type Person } from "./types";

type Screen =
  | { name: "home" }
  | { name: "capture"; personId: string; after: "features" | "family" }
  | { name: "features" }
  | { name: "family" }
  | { name: "results" };

export function App() {
  return (
    <PeopleProvider>
      <ErrorBoundary>
        <Shell />
      </ErrorBoundary>
    </PeopleProvider>
  );
}

function Shell() {
  const store = usePeople();
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: () => void }>(null);

  const person = screen.name === "capture" ? store.people.find((item) => item.id === screen.personId) : undefined;

  function startBaby() {
    const baby: Person = {
      id: uid(),
      kind: "baby",
      name: "Baby",
      relationship: "Baby",
      createdAt: Date.now(),
      photos: {},
    };
    void store.save(baby).then(() => setScreen({ name: "capture", personId: baby.id, after: "features" }));
  }

  return (
    <div className="app">
      {screen.name === "home" || (screen.name === "capture" && !person) ? (
        <HomeScreen
          baby={store.baby}
          familyCount={store.family.length}
          storageError={store.error}
          onStartBaby={startBaby}
          onFeatures={() => setScreen({ name: "features" })}
          onFamily={() => setScreen({ name: "family" })}
          onCompare={() => setScreen({ name: "results" })}
          onRetake={() => {
            if (store.baby) setScreen({ name: "capture", personId: store.baby.id, after: "features" });
          }}
          onReset={() =>
            setConfirm({
              title: "Start over?",
              body: "This deletes every photo stored on this phone for Baby Features.",
              action: () => {
                void store.reset();
                setScreen({ name: "home" });
              },
            })
          }
        />
      ) : null}

      {screen.name === "capture" && person ? (
        <CaptureScreen
          person={person}
          onSave={store.save}
          onBack={() => setScreen(screen.after === "family" ? { name: "family" } : { name: "home" })}
          onDone={() => setScreen(screen.after === "family" ? { name: "family" } : { name: "features" })}
        />
      ) : null}

      {screen.name === "features" && store.baby ? (
        <FeatureScreen
          person={store.baby}
          onSave={store.save}
          onBack={() => setScreen({ name: "home" })}
          onRetake={() => setScreen({ name: "capture", personId: store.baby!.id, after: "features" })}
          onAddFamily={() => setScreen({ name: "family" })}
        />
      ) : null}

      {screen.name === "family" && store.baby ? (
        <FamilyScreen
          baby={store.baby}
          family={store.family}
          onBack={() => setScreen({ name: "home" })}
          onAdd={(member) => {
            void store.save(member).then(() => setScreen({ name: "capture", personId: member.id, after: "family" }));
          }}
          onOpen={(id) => setScreen({ name: "capture", personId: id, after: "family" })}
          onDelete={(id) => {
            const member = store.family.find((item) => item.id === id);
            setConfirm({
              title: `Remove ${member?.name ?? "this person"}?`,
              body: "Their photos will be deleted from this phone.",
              action: () => void store.remove(id),
            });
          }}
          onCompare={() => setScreen({ name: "results" })}
        />
      ) : null}

      {screen.name === "results" && store.baby ? (
        <ResultsScreen
          baby={store.baby}
          family={store.family}
          onBack={() => setScreen({ name: "home" })}
          onAddFamily={() => setScreen({ name: "family" })}
        />
      ) : null}

      {confirm ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="card">
            <h2 id="confirm-title">{confirm.title}</h2>
            <p>{confirm.body}</p>
            <div className="actions">
              <button className="btn secondary" type="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  confirm.action();
                  setConfirm(null);
                }}
              >
                Yes, do it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || "Something went wrong." };
  }

  render() {
    if (this.state.message) {
      return (
        <div className="app">
          <h1>Something went wrong</h1>
          <p className="lede">{this.state.message}</p>
          <button className="btn" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

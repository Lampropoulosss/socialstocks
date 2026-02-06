import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import ServerList from './pages/ServerList';
import ServerUsers from './pages/ServerUsers';

function App() {
    return (
        <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
            {/* Navbar */}
            <nav className="sticky top-0 z-50 w-full border-b border-white/10 bg-background/80 backdrop-blur-md">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-2 font-bold text-xl tracking-tight text-white hover:opacity-80 transition-opacity">
                        <LayoutDashboard className="w-6 h-6 text-primary" />
                        <span>SocialStocks<span className="text-primary">.Bot</span></span>
                    </Link>
                </div>
            </nav>

            {/* Main Content */}
            <main className="container mx-auto px-4 py-8">
                <Routes>
                    <Route path="/" element={<ServerList />} />
                    <Route path="/server/:guildId" element={<ServerUsers />} />
                </Routes>
            </main>
        </div>
    );
}

export default App;

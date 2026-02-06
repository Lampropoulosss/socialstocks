import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Server, ChevronRight, Users, Search } from 'lucide-react';

interface Guild {
    id: string;
    name: string | null;
    icon: string | null;
    userCount: number;
}

const ServerList: React.FC = () => {
    const [guilds, setGuilds] = useState<Guild[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
    const [searchQuery, setSearchQuery] = useState('');

    const filteredGuilds = guilds.filter(guild =>
        guild.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (guild.name && guild.name.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    useEffect(() => {
        fetch('/api/guilds')
            .then(res => res.json())
            .then(data => {
                setGuilds(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const loadGuildDetails = async (e: React.MouseEvent, guildId: string) => {
        e.preventDefault(); // Prevent navigation if inside Link
        e.stopPropagation();

        setLoadingDetails(prev => ({ ...prev, [guildId]: true }));
        try {
            const res = await fetch(`/api/guilds/${guildId}/details`);
            const data = await res.json();

            setGuilds(prev => prev.map(g => {
                if (g.id === guildId) {
                    return { ...g, ...data };
                }
                return g;
            }));
        } catch (err) {
            console.error("Failed to load details", err);
        } finally {
            setLoadingDetails(prev => ({ ...prev, [guildId]: false }));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Connected Servers</h1>
                    <p className="text-muted-foreground mt-2">Manage users and economy for all servers using the bot.</p>
                </div>

                <div className="relative w-full md:w-64">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search by ID or Name..."
                        className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredGuilds.map(guild => (
                    <Link
                        key={guild.id}
                        to={`/server/${guild.id}`}
                        className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-6 hover:bg-white/10 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-primary/10 flex flex-col gap-4"
                    >
                        <div className="flex items-center gap-4">
                            {guild.icon ? (
                                <img
                                    src={guild.icon}
                                    alt={guild.name || 'Server'}
                                    className="w-16 h-16 rounded-2xl shadow-lg group-hover:shadow-primary/20 transition-all"
                                />
                            ) : (
                                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-white/50 shadow-lg group-hover:text-white transition-colors">
                                    <Server className="w-8 h-8" />
                                </div>
                            )}

                            <div className="flex-1 min-w-0">
                                {guild.name ? (
                                    <h2 className="text-xl font-semibold truncate text-white">{guild.name}</h2>
                                ) : (
                                    <h2 className="text-sm font-mono text-muted-foreground truncate">ID: {guild.id}</h2>
                                )}

                                <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1 group-hover:text-primary/80 transition-colors">
                                    <Users className="w-3 h-3" />
                                    <span>{guild.userCount} Users</span>
                                </div>
                            </div>

                            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-white group-hover:translate-x-1 transition-all self-center" />
                        </div>

                        {!guild.name && (
                            <button
                                onClick={(e) => loadGuildDetails(e, guild.id)}
                                disabled={loadingDetails[guild.id]}
                                className="w-full mt-2 py-2 px-4 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loadingDetails[guild.id] ? 'Loading...' : 'Load Server Info'}
                            </button>
                        )}
                    </Link>
                ))}

                {filteredGuilds.length === 0 && (
                    <div className="col-span-full py-12 text-center text-muted-foreground">
                        {searchQuery ? `No servers found matching "${searchQuery}"` : 'No servers found'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ServerList;

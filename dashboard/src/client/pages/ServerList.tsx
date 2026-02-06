import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Server, ChevronRight, Users } from 'lucide-react';

interface Guild {
    id: string;
    name: string;
    icon: string | null;
}

const ServerList: React.FC = () => {
    const [guilds, setGuilds] = useState<Guild[]>([]);
    const [loading, setLoading] = useState(true);

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

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Connected Servers</h1>
                <p className="text-muted-foreground mt-2">Manage users and economy for all servers using the bot.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {guilds.map(guild => (
                    <Link
                        key={guild.id}
                        to={`/server/${guild.id}`}
                        className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-6 hover:bg-white/10 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-primary/10"
                    >
                        <div className="flex items-center gap-4">
                            {guild.icon ? (
                                <img
                                    src={guild.icon}
                                    alt={guild.name}
                                    className="w-16 h-16 rounded-2xl shadow-lg group-hover:shadow-primary/20 transition-all"
                                />
                            ) : (
                                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-white/50 shadow-lg group-hover:text-white transition-colors">
                                    <Server className="w-8 h-8" />
                                </div>
                            )}

                            <div className="flex-1 min-w-0">
                                <h2 className="text-xl font-semibold truncate text-white">{guild.name}</h2>
                                <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1 group-hover:text-primary/80 transition-colors">
                                    <Users className="w-3 h-3" />
                                    <span>View Users</span>
                                </div>
                            </div>

                            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-white group-hover:translate-x-1 transition-all" />
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default ServerList;

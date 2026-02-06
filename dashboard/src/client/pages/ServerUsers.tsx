import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Search, Edit2, User as UserIcon } from 'lucide-react';
import UserEditor from '../components/UserEditor';

interface User {
    id: string;
    username: string;
    balance: string;
    netWorth: string;
    updatedAt: string;
    guildId: string;
}

const ServerUsers: React.FC = () => {
    const { guildId } = useParams<{ guildId: string }>();
    const [users, setUsers] = useState<User[]>([]);
    const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);

    useEffect(() => {
        fetch(`/api/guilds/${guildId}/users`)
            .then(res => res.json())
            .then(data => {
                setUsers(data);
                setFilteredUsers(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, [guildId]);

    useEffect(() => {
        const lower = search.toLowerCase();
        setFilteredUsers(users.filter(u => u.username.toLowerCase().includes(lower)));
    }, [search, users]);

    const handleUserUpdate = (updated: Partial<User>) => {
        setUsers(users.map(u => u.id === selectedUser?.id ? { ...u, ...updated } : u));
    };

    return (
        <div className="space-y-6">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Link to="/" className="p-2 hover:bg-white/10 rounded-full transition-colors text-muted-foreground hover:text-white">
                        <ArrowLeft className="w-6 h-6" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white">Server Users</h1>
                        <p className="text-muted-foreground">{users.length} users tracked</p>
                    </div>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search users..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full md:w-64 bg-secondary/30 border border-white/10 rounded-full pl-10 pr-4 py-2 focus:ring-2 focus:ring-primary focus:bg-secondary/50 focus:outline-none transition-all"
                    />
                </div>
            </header>

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : (
                <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden shadow-xl">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-white/10 bg-white/5">
                                    <th className="p-4 font-semibold text-muted-foreground">User</th>
                                    <th className="p-4 font-semibold text-muted-foreground text-right">Balance</th>
                                    <th className="p-4 font-semibold text-muted-foreground text-right">Net Worth</th>
                                    <th className="p-4 font-semibold text-muted-foreground text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filteredUsers.map(user => (
                                    <tr key={user.id} className="hover:bg-white/5 transition-colors group">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/80 to-purple-600 flex items-center justify-center text-white font-bold shadow-lg">
                                                    {user.username.charAt(0).toUpperCase()}
                                                </div>
                                                <span className="font-medium text-white">{user.username}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-right font-mono text-emerald-400">
                                            ${parseFloat(user.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-4 text-right font-mono text-blue-400">
                                            ${parseFloat(user.netWorth).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-4 text-right">
                                            <button
                                                onClick={() => setSelectedUser(user)}
                                                className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {filteredUsers.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="p-8 text-center text-muted-foreground">
                                            No users found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {selectedUser && (
                <UserEditor
                    user={selectedUser}
                    onClose={() => setSelectedUser(null)}
                    onSave={handleUserUpdate}
                />
            )}
        </div>
    );
};

export default ServerUsers;

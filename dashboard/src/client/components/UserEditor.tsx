import React, { useState } from 'react';
import { X, Save, DollarSign, TrendingUp } from 'lucide-react';

interface User {
    id: string;
    username: string;
    balance: string; // Decimal comes as string or number, check JSON
    netWorth: string;
    updatedAt: string;
}

interface UserEditorProps {
    user: User;
    onClose: () => void;
    onSave: (updatedUser: Partial<User>) => void;
}

const UserEditor: React.FC<UserEditorProps> = ({ user, onClose, onSave }) => {
    const [balance, setBalance] = useState(user.balance);
    const [netWorth, setNetWorth] = useState(user.netWorth);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch(`/api/users/${user.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    balance: parseFloat(balance),
                    netWorth: parseFloat(netWorth),
                }),
            });

            if (!res.ok) throw new Error('Failed to update');

            const data = await res.json();
            onSave(data);
            onClose();
        } catch (error) {
            console.error(error);
            alert('Error updating user');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-white/10 flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        Edit User <span className="text-primary">{user.username}</span>
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <DollarSign className="w-4 h-4" /> Balance
                        </label>
                        <input
                            type="number"
                            value={balance}
                            onChange={(e) => setBalance(e.target.value)}
                            className="w-full bg-secondary/50 border border-white/10 rounded-lg px-4 py-3 text-lg focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <TrendingUp className="w-4 h-4" /> Net Worth
                        </label>
                        <input
                            type="number"
                            value={netWorth}
                            onChange={(e) => setNetWorth(e.target.value)}
                            className="w-full bg-secondary/50 border border-white/10 rounded-lg px-4 py-3 text-lg focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                        />
                    </div>
                </div>

                <div className="p-6 pt-0 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg hover:bg-white/10 transition-colors font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-bold hover:brightness-110 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? 'Saving...' : (
                            <>
                                <Save className="w-4 h-4" /> Save Changes
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UserEditor;

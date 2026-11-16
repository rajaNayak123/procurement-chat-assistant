import React, { createContext, useContext, useState } from 'react';

export interface CurrentUser {
  name: string;
  email: string;
  role: 'Requester' | 'Buyer' | 'Procurement Head';
}

export const DEMO_USERS: CurrentUser[] = [
  { name: 'Aditi Sharma', email: 'aditi.sharma@corvo.internal', role: 'Requester' },
  { name: 'Rajesh Nair', email: 'rajesh.nair@corvo.internal', role: 'Buyer' },
  { name: 'Vikram Mehta', email: 'vikram.mehta@corvo.internal', role: 'Procurement Head' },
];

interface UserContextType {
  user: CurrentUser;
  setUser: (user: CurrentUser) => void;
}

const UserContext = createContext<UserContextType>({
  user: DEMO_USERS[1], // Default to Buyer
  setUser: () => {},
});

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<CurrentUser>(DEMO_USERS[1]);

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
};

export const useCurrentUser = () => useContext(UserContext);
